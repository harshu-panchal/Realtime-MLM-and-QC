import Product from "../../models/product.js";
import Category from "../../models/category.js";
import Seller from "../../models/seller.js";
import {
  PRODUCT_APPROVAL_STATUS,
  resolveProductApprovalStatus,
} from "../productModerationService.js";
import {
  COMMISSION_FIXED_RULE,
  COMMISSION_TYPE,
  DELIVERY_PRICING_MODE,
  HANDLING_FEE_STRATEGY,
  HANDLING_FEE_TYPE,
  isWalletRedemptionReducesPayableEnabled,
} from "../../constants/finance.js";
import {
  addMoney,
  ceilKm,
  clampMoney,
  percentOf,
  roundCurrency,
} from "../../utils/money.js";
import { getOrCreateFinanceSettings } from "./financeSettingsService.js";
import { calculateCustomerDeliveryCharge } from "./deliveryChargeService.js";
import { calculateRiderEarning } from "./riderEarningService.js";

function toObjectIdString(value) {
  if (!value) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function normalizeLineQuantity(quantity) {
  const q = Number(quantity || 0);
  if (!Number.isFinite(q) || q <= 0) return 1;
  return Math.floor(q);
}

function normalizeLinePrice(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? clampMoney(amount, 0) : 0;
}

// Commission is resolved from the SELLER, not the product's category. A
// seller with no commissionValue configured yet (shouldn't normally happen —
// approval is gated on it — but covers legacy/pre-migration sellers) falls
// back to Setting.defaultSellerCommissionPercent so admin revenue is never
// silently zero.
function resolveSellerCommissionConfig(seller, fallbackPercent = 0) {
  if (!seller) {
    return {
      type: COMMISSION_TYPE.PERCENTAGE,
      value: Number.isFinite(fallbackPercent) ? Math.max(fallbackPercent, 0) : 0,
      fixedRule: COMMISSION_FIXED_RULE.PER_QTY,
    };
  }

  const hasConfiguredValue =
    seller.commissionValue != null && Number.isFinite(Number(seller.commissionValue));

  if (!hasConfiguredValue) {
    return {
      type: COMMISSION_TYPE.PERCENTAGE,
      value: Number.isFinite(fallbackPercent) ? Math.max(fallbackPercent, 0) : 0,
      fixedRule: COMMISSION_FIXED_RULE.PER_QTY,
    };
  }

  const type = seller.commissionType || COMMISSION_TYPE.PERCENTAGE;
  const value = Number(seller.commissionValue);
  const fixedRule = seller.commissionFixedRule || COMMISSION_FIXED_RULE.PER_QTY;

  return {
    type,
    value: Math.max(value, 0),
    fixedRule,
  };
}

function resolveHandlingConfig(category) {
  if (!category) {
    return { type: HANDLING_FEE_TYPE.NONE, value: 0 };
  }

  const type =
    category.handlingFeeType ||
    (Number(category.handlingFees || 0) > 0
      ? HANDLING_FEE_TYPE.FIXED
      : HANDLING_FEE_TYPE.NONE);

  // Backward-compat: admin UI writes legacy `handlingFees` while pricing reads
  // `handlingFeeValue`. Since `handlingFeeValue` defaults to 0, treat it as
  // unset when legacy is non-zero.
  const legacyHandlingFees = Number(category.handlingFees ?? 0);
  const primaryHandlingValue = Number(category.handlingFeeValue);
  const resolvedRaw =
    category.handlingFeeValue == null ||
    (!Number.isFinite(primaryHandlingValue) ||
      (primaryHandlingValue === 0 && legacyHandlingFees > 0))
      ? legacyHandlingFees
      : primaryHandlingValue;
  const value = Number(resolvedRaw ?? 0);

  return {
    type,
    value: Number.isFinite(value) ? Math.max(value, 0) : 0,
  };
}

export function calculateProductSubtotal(items = []) {
  return roundCurrency(
    items.reduce((sum, item) => {
      const quantity = normalizeLineQuantity(item.quantity);
      const unitPrice = normalizeLinePrice(item.price);
      return sum + unitPrice * quantity;
    }, 0),
  );
}

export function calculateSellerCommission(item, sellerCommissionConfig) {
  const quantity = normalizeLineQuantity(item.quantity);
  const itemSubtotal = roundCurrency(normalizeLinePrice(item.price) * quantity);
  const { type, value, fixedRule } = sellerCommissionConfig;

  let adminCommission = 0;
  if (type === COMMISSION_TYPE.PERCENTAGE) {
    adminCommission = percentOf(itemSubtotal, value);
  } else {
    const fixedBase =
      fixedRule === COMMISSION_FIXED_RULE.PER_ITEM ? value : value * quantity;
    adminCommission = roundCurrency(fixedBase);
  }

  adminCommission = clampMoney(adminCommission, 0, itemSubtotal);
  const sellerPayout = roundCurrency(itemSubtotal - adminCommission);

  return {
    itemSubtotal,
    adminCommission,
    sellerPayout,
    appliedCommissionType: type,
    appliedCommissionValue: value,
    appliedFixedRule: fixedRule,
  };
}

function calculateHandlingForCategory({ type, value }, categorySubtotal) {
  if (type === HANDLING_FEE_TYPE.NONE) return 0;
  if (type === HANDLING_FEE_TYPE.PERCENTAGE) {
    return percentOf(categorySubtotal, value);
  }
  return roundCurrency(value);
}

export function calculateHandlingFee(cartItems, options = {}) {
  const {
    handlingFeeStrategy = HANDLING_FEE_STRATEGY.HIGHEST_CATEGORY_FEE,
    categoryById = new Map(),
  } = options;

  const categorySubtotalMap = new Map();
  for (const item of cartItems) {
    const headerId = toObjectIdString(item.headerCategoryId);
    const itemSubtotal = roundCurrency(normalizeLinePrice(item.price) * normalizeLineQuantity(item.quantity));
    categorySubtotalMap.set(headerId, addMoney(categorySubtotalMap.get(headerId) || 0, itemSubtotal));
  }

  const categoryFees = [];
  for (const [headerId, subtotal] of categorySubtotalMap.entries()) {
    const category = categoryById.get(headerId);
    const handling = resolveHandlingConfig(category);
    const fee = calculateHandlingForCategory(handling, subtotal);
    categoryFees.push({
      headerCategoryId: headerId || null,
      categoryName: category?.name || "Unknown",
      subtotal,
      handlingFeeType: handling.type,
      handlingFeeValue: handling.value,
      computedFee: roundCurrency(fee),
    });
  }

  let totalHandlingFee = 0;
  let handlingCategoryUsed = null;

  if (categoryFees.length === 0) {
    totalHandlingFee = 0;
  } else if (handlingFeeStrategy === HANDLING_FEE_STRATEGY.SUM_OF_CATEGORY_FEES) {
    totalHandlingFee = categoryFees.reduce((sum, row) => addMoney(sum, row.computedFee), 0);
  } else if (handlingFeeStrategy === HANDLING_FEE_STRATEGY.PER_ITEM_FEE) {
    totalHandlingFee = cartItems.reduce((sum, item) => {
      const headerId = toObjectIdString(item.headerCategoryId);
      const category = categoryById.get(headerId);
      const handling = resolveHandlingConfig(category);
      const quantity = normalizeLineQuantity(item.quantity);
      const itemSubtotal = roundCurrency(normalizeLinePrice(item.price) * quantity);
      const perLine =
        handling.type === HANDLING_FEE_TYPE.FIXED
          ? roundCurrency(handling.value * quantity)
          : calculateHandlingForCategory(handling, itemSubtotal);
      return addMoney(sum, perLine);
    }, 0);
  } else {
    const maxCategory = categoryFees.reduce((best, row) =>
      row.computedFee > (best?.computedFee || 0) ? row : best,
    );
    totalHandlingFee = roundCurrency(maxCategory?.computedFee || 0);
    handlingCategoryUsed = maxCategory || null;
  }

  if (!handlingCategoryUsed && categoryFees.length > 0) {
    handlingCategoryUsed = categoryFees
      .slice()
      .sort((a, b) => b.computedFee - a.computedFee)[0];
  }

  return {
    handlingFeeCharged: roundCurrency(totalHandlingFee),
    handlingFeeStrategy,
    handlingCategoryUsed,
    categoryFees,
  };
}

export function calculateCustomerDeliveryFee(distanceKm, deliverySettings) {
  const actualDistance = Number(distanceKm || 0);
  const normalizedDistance = Number.isFinite(actualDistance) ? Math.max(actualDistance, 0) : 0;
  
  const charge = calculateCustomerDeliveryCharge({ distanceKm: normalizedDistance, settings: deliverySettings });
  
  return {
    deliveryFeeCharged: charge,
    distanceKmActual: normalizedDistance,
    distanceKmRounded: roundCurrency(normalizedDistance),
    roundedExtraKm: 0,
    mode: deliverySettings.customerPricingType || "distance",
    baseFee: charge,
    extraFee: 0,
  };
}

export function calculateRiderPayout(distanceKm, deliverySettings) {
  const actualDistance = Number(distanceKm || 0);
  const normalizedDistance = Number.isFinite(actualDistance) ? Math.max(actualDistance, 0) : 0;

  const payout = calculateRiderEarning({ distanceKm: normalizedDistance, settings: deliverySettings });

  return {
    riderPayoutBase: payout,
    riderPayoutDistance: 0,
    riderPayoutBonus: 0,
    riderPayoutTotal: payout,
    roundedExtraKm: 0,
  };
}

export async function hydrateOrderItems(
  orderItems = [],
  { session = null, enforceServerPricing = true } = {},
) {
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    return [];
  }

  const productIds = orderItems
    .map((item) => item.product || item.productId || item._id || item.id)
    .filter(Boolean);

  const productQuery = Product.find({ _id: { $in: productIds } })
    .select("_id name salePrice price mainImage headerId sellerId status approvalStatus variants")
    .lean();
  if (session) productQuery.session(session);
  const products = await productQuery;

  const productMap = new Map(products.map((product) => [String(product._id), product]));

  return orderItems.map((item) => {
    const productId = String(item.product || item.productId || item._id || item.id);
    const product = productMap.get(productId);
    if (!product) {
      throw new Error(`Product not found for line item: ${productId}`);
    }
    if (product.status !== "active") {
      throw new Error(`Product is not available for purchase: ${product.name}`);
    }
    if (resolveProductApprovalStatus(product) !== PRODUCT_APPROVAL_STATUS.APPROVED) {
      throw new Error(`Product is not approved for purchase: ${product.name}`);
    }

    const rawVariantSku = String(item.variantSku || item.variantSlot || "").trim();
    let resolvedVariant = null;
    if (rawVariantSku) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      resolvedVariant =
        variants.find((v) => String(v?.sku || "").trim() === rawVariantSku) ||
        variants.find((v) => String(v?.name || "").trim() === rawVariantSku) ||
        null;
      if (!resolvedVariant) {
        const err = new Error(`Invalid variant for product: ${product.name}`);
        err.statusCode = 400;
        throw err;
      }
    }

    const quantity = normalizeLineQuantity(item.quantity);
    const serverUnitPrice = normalizeLinePrice(
      resolvedVariant
        ? resolvedVariant.salePrice || resolvedVariant.price || product.salePrice || product.price
        : product.salePrice || product.price,
    );
    const inferredUnitPrice = enforceServerPricing
      ? serverUnitPrice
      : normalizeLinePrice(item.price) || serverUnitPrice;

    return {
      productId,
      productName: item.name || product.name,
      quantity,
      price: inferredUnitPrice,
      image: item.image || product.mainImage,
      headerCategoryId: String(product.headerId),
      ...(product.sellerId ? { sellerId: String(product.sellerId) } : {}),
      variantSku: rawVariantSku || "",
      variantName: resolvedVariant ? String(resolvedVariant?.name || "").trim() : "",
    };
  });
}

export async function generateOrderPaymentBreakdown({
  items = [],
  preHydratedItems = null,
  distanceKm = 0,
  discountTotal = 0,
  taxTotal = 0,
  tipTotal = 0,
  // Audit Phase 4 (C-1): per-seller proportionate wallet redemption. The
  // checkout-group-level walletAmount is split by subtotal-ratio in
  // `buildCheckoutPricingSnapshot` before reaching this function. When the
  // `WALLET_REDEMPTION_REDUCES_PAYABLE` env flag is on, this amount is
  // subtracted from `grandTotal` so that the customer is asked to pay
  // (online or COD) only the post-wallet amount. When the flag is off the
  // value is still persisted (for visibility) but `grandTotal` keeps the
  // legacy pre-wallet value so existing flows are bit-for-bit unchanged.
  walletAmount = 0,
  deliverySettings,
  handlingFeeStrategy,
  session = null,
}) {
  const normalizedItems = Array.isArray(preHydratedItems) && preHydratedItems.length > 0
    ? preHydratedItems
    : await hydrateOrderItems(items, { session, enforceServerPricing: true });
  if (normalizedItems.length === 0) {
    throw new Error("Cart is empty");
  }

  const sellerIds = Array.from(new Set(normalizedItems.map((item) => item.sellerId)));
  if (sellerIds.length > 1) {
    throw new Error("Multi-seller checkout is not supported in current flow");
  }

  const headerIds = Array.from(
    new Set(normalizedItems.map((item) => item.headerCategoryId).filter(Boolean)),
  );

  // Handling fee is still resolved per header-category; commission no longer is.
  const categoryQuery = Category.find({ _id: { $in: headerIds } })
    .select("_id name handlingFees handlingFeeType handlingFeeValue")
    .lean();
  if (session) categoryQuery.session(session);
  const categories = await categoryQuery;
  const categoryById = new Map(categories.map((category) => [String(category._id), category]));

  const effectiveSettings =
    deliverySettings || (await getOrCreateFinanceSettings());
  const effectiveHandlingStrategy =
    handlingFeeStrategy || effectiveSettings.handlingFeeStrategy;

  // Commission is resolved once for the whole order from its single seller
  // (multi-seller checkout already throws above), falling back to the
  // finance-wide default when that seller has no rate configured yet.
  const sellerQuery = Seller.findById(sellerIds[0]).select(
    "commissionType commissionValue commissionFixedRule",
  );
  if (session) sellerQuery.session(session);
  const sellerDoc = await sellerQuery.lean();
  const sellerCommissionConfig = resolveSellerCommissionConfig(
    sellerDoc,
    effectiveSettings.defaultSellerCommissionPercent,
  );

  let productSubtotal = 0;
  let sellerPayoutTotal = 0;
  let adminProductCommissionTotal = 0;

  const lineItems = normalizedItems.map((item) => {
    const category = categoryById.get(String(item.headerCategoryId));
    const commission = calculateSellerCommission(item, sellerCommissionConfig);
    productSubtotal = addMoney(productSubtotal, commission.itemSubtotal);
    sellerPayoutTotal = addMoney(sellerPayoutTotal, commission.sellerPayout);
    adminProductCommissionTotal = addMoney(
      adminProductCommissionTotal,
      commission.adminCommission,
    );

    return {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.price,
      itemSubtotal: commission.itemSubtotal,
      sellerPayout: commission.sellerPayout,
      adminProductCommission: commission.adminCommission,
      headerCategoryId: item.headerCategoryId,
      headerCategoryName: category?.name || "Unknown",
      appliedCommissionType: commission.appliedCommissionType,
      appliedCommissionValue: commission.appliedCommissionValue,
      appliedCommissionFixedRule: commission.appliedFixedRule,
    };
  });

  const handling = calculateHandlingFee(normalizedItems, {
    handlingFeeStrategy: effectiveHandlingStrategy,
    categoryById,
  });
  const delivery = calculateCustomerDeliveryFee(distanceKm, effectiveSettings);
  const rider = calculateRiderPayout(distanceKm, effectiveSettings);

  const normalizedDiscount = roundCurrency(discountTotal || 0);
  const normalizedTax = roundCurrency(taxTotal || 0);
  const normalizedTip = roundCurrency(tipTotal || 0);
  const normalizedWallet = roundCurrency(walletAmount || 0);

  const grossTotal = roundCurrency(
    productSubtotal +
      delivery.deliveryFeeCharged +
      handling.handlingFeeCharged -
      normalizedDiscount +
      normalizedTax +
      normalizedTip,
  );

  // Audit Phase 4 (C-1): subtract wallet redemption only when the flag is on.
  // The wallet amount is clamped to [0, grossTotal] so a malformed input
  // cannot drive grandTotal negative. We keep `grossTotal` for the new
  // `payableAmount` field below — clients that want the pre-wallet number
  // can still read `grossTotal` while migrating UIs.
  const walletAllocation = isWalletRedemptionReducesPayableEnabled()
    ? Math.min(normalizedWallet, grossTotal)
    : 0;
  const grandTotal = roundCurrency(grossTotal - walletAllocation);

  const riderTipAmount = normalizedTip;
  const riderPayoutTotal = roundCurrency(
    rider.riderPayoutBase +
      rider.riderPayoutDistance +
      rider.riderPayoutBonus +
      riderTipAmount,
  );

  const platformLogisticsMargin = roundCurrency(
    delivery.deliveryFeeCharged +
      handling.handlingFeeCharged -
      (rider.riderPayoutBase + rider.riderPayoutDistance + rider.riderPayoutBonus),
  );
  const platformTotalEarning = roundCurrency(
    adminProductCommissionTotal + platformLogisticsMargin,
  );

  const snapshots = {
    deliverySettings: {
      ...effectiveSettings,
    },
    // Historical field — no longer populated now that commission is
    // seller-based. Left as an empty array (rather than removed) so any
    // code still reading it on old orders keeps working.
    categoryCommissionSettings: [],
    sellerCommissionSettings: {
      sellerId: sellerIds[0] || null,
      sellerCommissionType: sellerCommissionConfig.type,
      sellerCommissionValue: sellerCommissionConfig.value,
      sellerCommissionFixedRule: sellerCommissionConfig.fixedRule,
    },
    categoryHandlingFeeSettings: categories.map((category) => ({
      headerCategoryId: String(category._id),
      headerCategoryName: category.name,
      handlingFeeType:
        category.handlingFeeType || HANDLING_FEE_TYPE.FIXED,
      handlingFeeValue: resolveHandlingConfig(category).value,
    })),
    handlingFeeStrategy: effectiveHandlingStrategy,
    handlingCategoryUsed: handling.handlingCategoryUsed,
  };

  return {
    sellerId: sellerIds[0],
    lineItems,
    currency: "INR",
    productSubtotal,
    deliveryFeeCharged: delivery.deliveryFeeCharged,
    handlingFeeCharged: handling.handlingFeeCharged,
    tipTotal: normalizedTip,
    discountTotal: normalizedDiscount,
    taxTotal: normalizedTax,
    // Audit Phase 4 (C-1):
    //   - `grossTotal`: pre-wallet customer-payable amount. New field —
    //     legacy callers ignore it.
    //   - `grandTotal`: post-wallet amount when the flag is on (the actual
    //     amount PhonePe charges / rider collects); equals `grossTotal`
    //     when the flag is off (legacy behaviour preserved).
    //   - `walletAmount`: per-seller proportionate wallet redemption.
    //   - `payableAmount`: alias of `grandTotal` for the post-C-1 world,
    //     surfaced separately so the frontend can stop subtracting
    //     `walletAmount` from `grandTotal` once the flag is on.
    grossTotal,
    grandTotal,
    walletAmount: walletAllocation,
    payableAmount: grandTotal,
    sellerPayoutTotal,
    adminProductCommissionTotal,
    riderPayoutBase: rider.riderPayoutBase,
    riderPayoutDistance: rider.riderPayoutDistance,
    riderPayoutBonus: rider.riderPayoutBonus,
    riderTipAmount,
    riderPayoutTotal,
    platformLogisticsMargin,
    platformTotalEarning,
    codCollectedAmount: 0,
    codRemittedAmount: 0,
    codPendingAmount: 0,
    distanceKmActual: delivery.distanceKmActual,
    distanceKmRounded: delivery.distanceKmRounded,
    snapshots,
  };
}
