import Seller from "../models/seller.js";
import Setting from "../models/setting.js";
import crypto from "crypto";
import Delivery from "../models/delivery.js";
import { computeWithdrawalCharges, WITHDRAWAL_TRANSFER_TYPES } from "../services/admin/walletAdminService.js";
import Transaction from "../models/transaction.js";
import Product from "../models/product.js";
import Category from "../models/category.js";
import { handleResponse, calculateDistance } from "../utils/helper.js";
import mongoose from "mongoose";
import { invalidateSellerName } from "../services/entityNameCache.js";
import { getApprovedOrLegacyFilter } from "../services/productModerationService.js";

/* ===============================
   GET NEARBY SELLERS
================================ */
// This is the Quick tab's dedicated lookup — permanently scoped to
// Quick Commerce sellers, since E-commerce sellers are never subject to
// radius/proximity gating (see customerVisibilityService.getEcommerceSellerIds
// for the ShopAll counterpart).
export const getNearbySellers = async (req, res) => {
  try {
    const { lat, lng, headerId, categoryId } = req.query;

    if (!lat || !lng) {
      return handleResponse(res, 400, "Latitude and longitude are required");
    }

    const customerLat = Number(lat);
    const customerLng = Number(lng);

    // Fetch all active/verified quick commerce sellers
    const sellers = await Seller.find({
      isActive: true,
      isVerified: true,
      businessType: "quick_commerce",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [customerLng, customerLat],
          },
          $maxDistance: 100000, // 100km max search area
        },
      },
    })
      .select(
        "shopName address locality city pincode state location serviceRadius isActive isVerified businessType bannerImage bannerImages logo rating deliveryTime offerTitle offerSubtitle"
      )
      .lean();

    // Filter based on individual service radius
    let nearbySellers = sellers.filter((seller) => {
      const sellerLng = seller.location?.coordinates?.[0];
      const sellerLat = seller.location?.coordinates?.[1];
      if (sellerLat === undefined || sellerLng === undefined) return false;

      const distance = calculateDistance(
        customerLat,
        customerLng,
        sellerLat,
        sellerLng
      );

      seller.distance = distance;
      return distance <= (seller.serviceRadius || 5);
    });

    // Scope to sellers having active products in category if category filter is present
    const categoryFilter = headerId || categoryId;
    if (categoryFilter && nearbySellers.length > 0) {
      const matchingSellerIds = await Product.distinct("sellerId", {
        sellerId: { $in: nearbySellers.map((s) => s._id) },
        status: "active",
        $or: [{ headerId: categoryFilter }, { categoryId: categoryFilter }],
      });
      const matchingSet = new Set(matchingSellerIds.map(String));
      nearbySellers = nearbySellers.filter((seller) => matchingSet.has(String(seller._id)));
    }

    // Parallel fast fetch top 4 active products per seller (indexed + limited per seller)
    if (nearbySellers.length > 0) {
      await Promise.all(
        nearbySellers.map(async (seller) => {
          const prods = await Product.find({
            sellerId: seller._id,
            status: "active",
          })
            .select("name mainImage image images price salePrice discountPrice")
            .limit(4)
            .lean();

          seller.topProducts = prods.map((prod) => ({
            _id: prod._id,
            name: prod.name,
            image: prod.mainImage || prod.image || (prod.images && prod.images[0]) || "",
            price: prod.salePrice || prod.discountPrice || prod.price || 0,
            originalPrice: prod.price || 0,
          }));
        })
      );
    }

    return handleResponse(
      res,
      200,
      "Nearby sellers fetched successfully",
      nearbySellers
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET SELLER STOREFRONT (public, Quick tab)
================================ */
// Powers the seller storefront page: seller identity + the list of
// categories this seller actually has active products under (rendered as
// tabs). Product data per tab is fetched separately via the existing
// getProducts endpoint (sellerId + categoryId + mode=quick) to avoid a
// second products-listing implementation.
export const getSellerStorefront = async (req, res) => {
  try {
    const { sellerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return handleResponse(res, 400, "Invalid seller id");
    }

    const seller = await Seller.findOne({
      _id: sellerId,
      isActive: true,
      isVerified: true,
    })
      .select(
        "shopName address businessType bannerImage bannerImages logo rating locality city serviceRadius category description deliveryTime offerTitle offerSubtitle"
      )
      .lean();

    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }

    const categoryIds = await Product.distinct("categoryId", {
      $and: [{ sellerId, status: "active" }, getApprovedOrLegacyFilter()],
    });

    const categories = categoryIds.length
      ? await Category.find({ _id: { $in: categoryIds } })
          .select("name image sortOrder")
          .sort({ sortOrder: 1, name: 1 })
          .lean()
      : [];

    return handleResponse(res, 200, "Seller storefront fetched successfully", {
      seller,
      categories,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   REQUEST WITHDRAWAL (Seller)
================================ */
export const requestWithdrawal = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return handleResponse(res, 400, "Please enter a valid amount");
    }

    // Seller must have an active paid subscription to withdraw (only when a fee is set in Settings).
    const subCheck = await getSellerSubscriptionState(sellerId);
    if (subCheck.required && !subCheck.isActive) {
      return handleResponse(
        res,
        403,
        "Your subscription is not active. Please pay the seller subscription to request a withdrawal.",
        subCheck,
      );
    }

    // 1. Calculate current available balance
    // Consistent with getSellerEarnings logic in sellerStatsController.js
    const transactions = await Transaction.find({
      user: sellerId,
      userModel: "Seller",
    })
      .select("status amount type")
      .lean();

    const settledBalance = transactions
      .filter((t) => t.status === "Settled")
      .reduce((acc, t) => acc + (t.amount || 0), 0);

    const pendingPayouts = transactions
      .filter(
        (t) =>
          t.type === "Withdrawal" &&
          (t.status === "Pending" || t.status === "Processing"),
      )
      .reduce((acc, t) => acc + Math.abs(t.amount || 0), 0);

    const availableBalance = settledBalance - pendingPayouts;

    if (amount > availableBalance) {
      return handleResponse(
        res,
        400,
        `Insufficient balance. Available: ₹${availableBalance}`,
      );
    }

    // 2. Deductions from Settings (TDS + service charge + admin charge)
    // Transfer type: bank_transfer | wallet_to_wallet | quick_transfer (quick = extra % from Settings)
    const transferType = WITHDRAWAL_TRANSFER_TYPES.includes(req.body?.transferType) ? req.body.transferType : "bank_transfer";
    const charges = await computeWithdrawalCharges(amount, transferType);

    // 3. Create Withdrawal Transaction
    // Withdrawals have negative amounts per the model comment.
    // Full requested amount leaves the wallet; seller is paid charges.netPayable.
    const withdrawal = await Transaction.create({
      user: sellerId,
      userModel: "Seller",
      type: "Withdrawal",
      amount: -Math.abs(amount),
      status: "Pending",
      reference: `WDR-${Date.now()}`,
      meta: { transferType, withdrawalCharges: charges },
    });

    return handleResponse(
      res,
      201,
      "Withdrawal request submitted successfully",
      withdrawal,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET SELLER PROFILE
================================ */
export const getSellerProfile = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.id);
    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }
    return handleResponse(
      res,
      200,
      "Seller profile fetched successfully",
      seller,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   UPDATE SELLER PROFILE
================================ */
export const updateSellerProfile = async (req, res) => {
  try {
    const {
      name,
      shopName,
      phone,
      address,
      locality,
      pincode,
      city,
      state,
      lat,
      lng,
      radius,
      bannerImage,
      bannerImages,
      logo,
      deliveryTime,
      offerTitle,
      offerSubtitle,
      category,
      description,
      rating,
      freeDelivery,
      takeawayEnabled,
    } = req.body;

    // Find seller
    const seller = await Seller.findById(req.user.id);
    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }

    // Update fields if provided
    if (name) seller.name = name;
    if (shopName) seller.shopName = shopName;
    if (phone) seller.phone = phone;
    if (address !== undefined) seller.address = address;
    if (locality !== undefined) seller.locality = locality;
    if (pincode !== undefined) seller.pincode = pincode;
    if (city !== undefined) seller.city = city;
    if (state !== undefined) seller.state = state;
    if (bannerImages !== undefined) {
      if (!Array.isArray(bannerImages)) {
        return handleResponse(res, 400, "bannerImages must be an array of image URLs");
      }
      const cleanedBanners = bannerImages
        .map((url) => String(url || "").trim())
        .filter(Boolean);
      if (cleanedBanners.length > 8) {
        return handleResponse(res, 400, "A maximum of 8 banner images is allowed");
      }
      seller.bannerImages = cleanedBanners;
      // Keep the legacy single-banner field in sync so any older reader
      // (e.g. cached clients) still shows a sensible cover image.
      seller.bannerImage = cleanedBanners[0] || "";
    } else if (bannerImage !== undefined) {
      seller.bannerImage = bannerImage;
    }
    if (logo !== undefined) seller.logo = logo;
    if (deliveryTime !== undefined) seller.deliveryTime = deliveryTime;
    if (offerTitle !== undefined) seller.offerTitle = offerTitle;
    if (offerSubtitle !== undefined) seller.offerSubtitle = offerSubtitle;
    if (category !== undefined) seller.category = category;
    if (description !== undefined) seller.description = description;
    if (rating !== undefined) seller.rating = Number(rating);
    if (freeDelivery !== undefined) seller.freeDelivery = freeDelivery === true || freeDelivery === "true";
    if (takeawayEnabled !== undefined) seller.takeawayEnabled = takeawayEnabled === true || takeawayEnabled === "true";

    // Validate and update geo data
    if (lat !== undefined && lng !== undefined) {
      if (lat < -90 || lat > 90)
        return handleResponse(res, 400, "Invalid latitude");
      if (lng < -180 || lng > 180)
        return handleResponse(res, 400, "Invalid longitude");

      seller.location = {
        type: "Point",
        coordinates: [Number(lng), Number(lat)],
      };
    }

    if (radius !== undefined) {
      if (radius < 1 || radius > 100)
        return handleResponse(res, 400, "Radius must be between 1 and 100 km");
      seller.serviceRadius = Number(radius);
    }

    const updatedSeller = await seller.save();

    // Invalidate cached seller name in case shopName changed
    invalidateSellerName(req.user.id).catch((err) => {
      console.warn("[Seller] Name cache invalidation failed:", err.message);
    });

    return handleResponse(
      res,
      200,
      "Profile updated successfully",
      updatedSeller,
    );
  } catch (error) {
    // Handle duplicate phone error
    if (error.code === 11000) {
      return handleResponse(res, 400, "Phone number already in use");
    }
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   SELLER OWN DELIVERY BOYS (Free Delivery)
================================ */
const SELLER_RIDER_FIELDS = "name phone vehicleType vehicleNumber isOnline isActive createdAt";

export const getSellerDeliveryBoys = async (req, res) => {
  try {
    const riders = await Delivery.find({ sellerId: req.user.id, isActive: { $ne: false } })
      .select(SELLER_RIDER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    return handleResponse(res, 200, "Delivery boys fetched successfully", riders);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const addSellerDeliveryBoy = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.id).select("freeDelivery");
    if (!seller) return handleResponse(res, 404, "Seller not found");
    if (!seller.freeDelivery) {
      return handleResponse(res, 400, "Turn on Free Delivery to add your own delivery boys");
    }

    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").replace(/\D/g, "").slice(-10);
    const vehicleType = ["bike", "cycle", "scooter"].includes(req.body?.vehicleType)
      ? req.body.vehicleType
      : "bike";
    const vehicleNumber = String(req.body?.vehicleNumber || "").trim();

    if (name.length < 2) return handleResponse(res, 400, "Name is required");
    if (!/^[6-9]\d{9}$/.test(phone)) return handleResponse(res, 400, "Enter a valid 10-digit mobile number");

    let rider = await Delivery.findOne({ phone });
    if (rider) {
      const isMineRemoved = rider.sellerId && String(rider.sellerId) === String(seller._id) && rider.isActive === false;
      const isUnfinishedSignup = !rider.isVerified && !rider.sellerId;
      if (!isMineRemoved && !isUnfinishedSignup) {
        return handleResponse(res, 400, "This mobile number is already registered as a delivery partner");
      }
      // Re-add own removed rider, or take over an unfinished (unverified) signup.
      rider.name = name;
      rider.vehicleType = vehicleType;
      rider.vehicleNumber = vehicleNumber;
      rider.sellerId = seller._id;
      rider.isVerified = true;
      rider.isActive = true;
      rider.onboardingPayment = { status: "exempt", amount: 0 };
      await rider.save();
    } else {
      rider = await Delivery.create({
        name,
        phone,
        vehicleType,
        vehicleNumber,
        sellerId: seller._id,
        isVerified: true,
        isActive: true,
        isOnline: false,
        onboardingPayment: { status: "exempt", amount: 0 },
      });
    }

    const result = await Delivery.findById(rider._id).select(SELLER_RIDER_FIELDS).lean();
    return handleResponse(res, 201, "Delivery boy added successfully", result);
  } catch (error) {
    if (error.code === 11000) {
      return handleResponse(res, 400, "This mobile number is already registered as a delivery partner");
    }
    return handleResponse(res, 500, error.message);
  }
};

export const removeSellerDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return handleResponse(res, 400, "Invalid delivery boy id");

    // Deactivate (not hard delete) so past orders keep their rider reference.
    const rider = await Delivery.findOneAndUpdate(
      { _id: id, sellerId: req.user.id },
      { $set: { isActive: false, isOnline: false } },
      { new: true },
    ).select(SELLER_RIDER_FIELDS);

    if (!rider) return handleResponse(res, 404, "Delivery boy not found");
    return handleResponse(res, 200, "Delivery boy removed successfully", { id });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};


/* ===============================
   SELLER PAID SUBSCRIPTION (required to withdraw)
================================ */
async function getSellerSubscriptionState(sellerId) {
  const [seller, setting] = await Promise.all([
    Seller.findById(sellerId).select("subscription").lean(),
    Setting.findOne().select("sellerSubscriptionFee sellerSubscriptionValidityDays").lean(),
  ]);
  const fee = Math.max(0, Number(setting?.sellerSubscriptionFee ?? 0));
  const validityDays = Math.max(1, Number(setting?.sellerSubscriptionValidityDays ?? 30));
  const sub = seller?.subscription || {};
  const isActive = !!(sub.expiresAt && new Date(sub.expiresAt) > new Date());
  return {
    required: fee > 0,
    isActive,
    status: isActive ? "active" : sub.expiresAt ? "expired" : "none",
    fee,
    validityDays,
    expiresAt: sub.expiresAt || null,
    paidAt: sub.paidAt || null,
  };
}

export const getSellerSubscriptionStatus = async (req, res) => {
  try {
    const state = await getSellerSubscriptionState(req.user.id);
    return handleResponse(res, 200, "Seller subscription status fetched", state);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const createSellerSubscriptionOrder = async (req, res) => {
  try {
    const state = await getSellerSubscriptionState(req.user.id);
    if (!state.required) {
      return handleResponse(res, 200, "Seller subscription is not required right now", { exempt: true, amount: 0 });
    }

    const { RazorpayAdapter } = await import("../services/payment/providers/razorpay.adapter.js");
    const adapter = new RazorpayAdapter();
    const merchantOrderId = `SSUB_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const result = await adapter.initiatePayment({
      merchantOrderId,
      amountPaise: Math.round(state.fee * 100),
      redirectUrl: "",
    });

    return handleResponse(res, 200, "Seller subscription order created", {
      razorpayOrderId: result.gatewayResponse?.razorpayOrderId,
      amount: state.fee,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
      validityDays: state.validityDays,
      merchantOrderId,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message || "Failed to initialize payment");
  }
};

export const verifySellerSubscriptionPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return handleResponse(res, 400, "Payment verification parameters missing");
    }
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) return handleResponse(res, 500, "Payment gateway secret not configured");

    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (expected !== razorpay_signature) {
      return handleResponse(res, 400, "Invalid payment signature");
    }

    // Same payment must not activate twice.
    const used = await Seller.findOne({ "subscription.razorpayPaymentId": razorpay_payment_id }).select("_id").lean();
    if (used) {
      if (String(used._id) === String(req.user.id)) {
        const state = await getSellerSubscriptionState(req.user.id);
        return handleResponse(res, 200, "Subscription already activated for this payment", state);
      }
      return handleResponse(res, 400, "This payment has already been used");
    }

    const seller = await Seller.findById(req.user.id);
    if (!seller) return handleResponse(res, 404, "Seller not found");

    const state = await getSellerSubscriptionState(req.user.id);
    // Renewing early extends from the current expiry; otherwise from now.
    const now = new Date();
    const base = seller.subscription?.expiresAt && new Date(seller.subscription.expiresAt) > now
      ? new Date(seller.subscription.expiresAt)
      : now;
    const expiresAt = new Date(base.getTime() + state.validityDays * 24 * 60 * 60 * 1000);

    seller.subscription = {
      status: "active",
      amount: state.fee,
      paidAt: now,
      expiresAt,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
    };
    await seller.save();

    const updated = await getSellerSubscriptionState(req.user.id);
    return handleResponse(res, 200, "Seller subscription activated successfully", updated);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
