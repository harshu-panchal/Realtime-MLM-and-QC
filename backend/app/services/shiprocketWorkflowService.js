import Order from "../models/order.js";
import { WORKFLOW_STATUS, legacyStatusFromWorkflow } from "../constants/orderWorkflow.js";
import { pushOrder, assignAwb, generatePickup } from "./shiprocketService.js";
import { emitOrderStatusUpdate } from "./orderSocketEmitter.js";
import { requireCanonicalOrderId } from "../utils/orderLookup.js";
import logger from "./logger.js";

/**
 * Orchestrates the E-commerce (Shiprocket) order lifecycle. This is the
 * ecommerce-only counterpart to orderWorkflowService.js's hyperlocal
 * rider-broadcast machinery — the two never share transition functions.
 *
 * KNOWN LIMITATION: Order.address (captured at checkout for hyperlocal
 * delivery) has no dedicated pincode/state fields — only a free-text
 * `address` string. buildShiprocketOrderPayload() best-effort-extracts a
 * 6-digit pincode from that string and leaves billing_state blank when it
 * can't be inferred. Shiprocket's serviceability checks require both, so a
 * checkout-flow change to capture structured pincode/state for ecommerce
 * orders is a real follow-up — flagged here rather than silently assumed
 * correct.
 */

const DEFAULT_PACKAGE_DIMENSIONS_CM = { length: 10, breadth: 10, height: 10 };
const DEFAULT_PACKAGE_WEIGHT_KG = 0.5;

function extractPincode(addressText = "") {
  const match = String(addressText || "").match(/\b\d{6}\b/);
  return match ? match[0] : "";
}

function getPickupLocationNickname() {
  const nickname = process.env.SHIPROCKET_PICKUP_LOCATION;
  if (!nickname) {
    throw new Error("SHIPROCKET_PICKUP_LOCATION is not configured");
  }
  return nickname;
}

export function buildShiprocketOrderPayload(order) {
  const address = order.address || {};
  const pincode = extractPincode(address.address);
  const subTotal = order.paymentBreakdown?.productSubtotal || order.pricing?.subtotal || 0;

  return {
    order_id: order.orderId,
    order_date: new Date(order.createdAt || Date.now()).toISOString().slice(0, 19).replace("T", " "),
    pickup_location: getPickupLocationNickname(),
    billing_customer_name: address.name || "Customer",
    billing_last_name: "",
    billing_address: address.address || "",
    billing_city: address.city || "",
    billing_pincode: pincode,
    billing_state: address.state || "",
    billing_country: "India",
    billing_email: order.customerEmail || "customer@example.com",
    billing_phone: address.phone || "",
    shipping_is_billing: true,
    order_items: (order.items || []).map((item) => ({
      name: item.name || "Item",
      sku: String(item.product || item._id || "item"),
      units: item.quantity || 1,
      selling_price: item.price || 0,
    })),
    payment_method: order.paymentMode === "COD" ? "COD" : "Prepaid",
    sub_total: subTotal,
    length: DEFAULT_PACKAGE_DIMENSIONS_CM.length,
    breadth: DEFAULT_PACKAGE_DIMENSIONS_CM.breadth,
    height: DEFAULT_PACKAGE_DIMENSIONS_CM.height,
    weight: DEFAULT_PACKAGE_WEIGHT_KG,
  };
}

async function transitionTo(orderId, workflowStatus, extraSet = {}) {
  return Order.findOneAndUpdate(
    { orderId },
    {
      $set: {
        workflowStatus,
        status: legacyStatusFromWorkflow(workflowStatus),
        ...extraSet,
      },
    },
    { new: true },
  );
}

/**
 * Runs the full push -> AWB -> pickup sequence for an ecommerce order that
 * has just moved to SELLER_ACCEPTED. Each step persists as it completes so
 * a failure partway through leaves a clear, resumable trail on the order
 * rather than losing progress — this function does not currently retry
 * automatically; a stalled order is visible via shipment.trackingStatus
 * being unset past SHIPMENT_CREATED and can be retried manually (Phase 2
 * follow-up: an admin "retry shipment" action).
 */
export async function handleSellerAccept(order) {
  const orderId = order.orderId;

  try {
    const payload = buildShiprocketOrderPayload(order);
    const pushResult = await pushOrder(payload);

    const shipmentId = pushResult?.shipment_id;
    const shiprocketOrderId = pushResult?.order_id;

    const afterPush = await transitionTo(orderId, WORKFLOW_STATUS.SHIPMENT_CREATED, {
      "shipment.shiprocketOrderId": shiprocketOrderId,
      "shipment.shipmentId": shipmentId,
    });

    emitOrderStatusUpdate(
      orderId,
      { workflowStatus: WORKFLOW_STATUS.SHIPMENT_CREATED },
      afterPush?.customer,
    );

    const awbResult = await assignAwb({ shipmentId });
    const awbData = awbResult?.response?.data || awbResult || {};

    await Order.findOneAndUpdate(
      { orderId },
      {
        $set: {
          "shipment.awbCode": awbData.awb_code,
          "shipment.courierName": awbData.courier_name,
          "shipment.courierId": awbData.courier_company_id,
        },
      },
    );

    const pickupResult = await generatePickup({ shipmentId });

    const afterPickup = await transitionTo(orderId, WORKFLOW_STATUS.PICKUP_SCHEDULED, {
      "shipment.pickupScheduledAt": new Date(),
      "shipment.pickupTokenNumber": pickupResult?.pickup_token_number || "",
    });

    emitOrderStatusUpdate(
      orderId,
      { workflowStatus: WORKFLOW_STATUS.PICKUP_SCHEDULED },
      afterPickup?.customer,
    );

    return afterPickup;
  } catch (error) {
    logger.error(`[shiprocketWorkflowService] handleSellerAccept failed for ${orderId}: ${error.message}`);
    throw error;
  }
}

const TRACKING_STATUS_TO_WORKFLOW = {
  shipped: WORKFLOW_STATUS.SHIPPED,
  "in transit": WORKFLOW_STATUS.IN_TRANSIT,
  in_transit: WORKFLOW_STATUS.IN_TRANSIT,
  "out for delivery": WORKFLOW_STATUS.OUT_FOR_DELIVERY_COURIER,
  out_for_delivery: WORKFLOW_STATUS.OUT_FOR_DELIVERY_COURIER,
  // Never jump straight to DELIVERED — the customer (or an admin override)
  // must confirm receipt first. See confirm-received / force-delivered.
  delivered: WORKFLOW_STATUS.DELIVERED_PENDING_CONFIRMATION,
  rto: WORKFLOW_STATUS.RTO,
  "rto initiated": WORKFLOW_STATUS.RTO,
  "return to origin": WORKFLOW_STATUS.RTO,
  undelivered: WORKFLOW_STATUS.RTO,
};

function resolveWorkflowFromTrackingStatus(currentStatus) {
  const normalized = String(currentStatus || "").trim().toLowerCase();
  return TRACKING_STATUS_TO_WORKFLOW[normalized] || null;
}

/**
 * Applies an incoming Shiprocket tracking webhook payload to the matching
 * order. Looks the order up by AWB (most reliable webhook identifier),
 * falling back to Shiprocket's order_id. Appends to trackingHistory
 * regardless of whether the status maps to a workflow transition, so the
 * full raw history is always retrievable even for statuses we don't
 * explicitly model.
 */
export async function processTrackingWebhook(payload = {}) {
  const awbCode = payload.awb || payload.awb_code;
  const shiprocketOrderId = payload.order_id;

  const order = awbCode
    ? await Order.findOne({ "shipment.awbCode": awbCode })
    : await Order.findOne({ "shipment.shiprocketOrderId": shiprocketOrderId });

  if (!order) {
    const error = new Error("No matching order found for this tracking webhook");
    error.statusCode = 404;
    throw error;
  }

  const historyEntry = {
    status: payload.current_status || "",
    statusDate: payload.current_status_date ? new Date(payload.current_status_date) : new Date(),
    activity: payload.current_status || "",
    location: payload.location || "",
    raw: payload,
  };

  const nextWorkflowStatus = resolveWorkflowFromTrackingStatus(payload.current_status);
  const update = {
    $push: { "shipment.trackingHistory": historyEntry },
    $set: { "shipment.trackingStatus": payload.current_status || order.shipment?.trackingStatus },
  };
  if (nextWorkflowStatus) {
    update.$set.workflowStatus = nextWorkflowStatus;
    update.$set.status = legacyStatusFromWorkflow(nextWorkflowStatus);
  }

  const updated = await Order.findOneAndUpdate({ _id: order._id }, update, { new: true });

  if (nextWorkflowStatus) {
    emitOrderStatusUpdate(updated.orderId, { workflowStatus: nextWorkflowStatus }, updated.customer);
  }

  return updated;
}

/**
 * Customer confirms receipt — the only normal path from
 * DELIVERED_PENDING_CONFIRMATION to DELIVERED for ecommerce orders (no
 * proximity/OTP handoff is possible for a nationwide shipment).
 */
export async function confirmDeliveryByCustomer({ orderId, customerId }) {
  const order = await Order.findOneAndUpdate(
    {
      orderId,
      customer: customerId,
      workflowStatus: WORKFLOW_STATUS.DELIVERED_PENDING_CONFIRMATION,
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.DELIVERED,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED),
        "deliveryConfirmedByCustomer.confirmed": true,
        "deliveryConfirmedByCustomer.confirmedAt": new Date(),
        "deliveryConfirmedByCustomer.confirmedVia": "customer",
      },
    },
    { new: true },
  );

  if (!order) {
    const error = new Error("Order is not awaiting delivery confirmation");
    error.statusCode = 409;
    throw error;
  }

  emitOrderStatusUpdate(order.orderId, { workflowStatus: WORKFLOW_STATUS.DELIVERED }, order.customer);
  return order;
}

/**
 * Admin fallback for customers who never confirm receipt.
 */
export async function forceMarkDelivered({ orderId, adminId }) {
  const order = await Order.findOneAndUpdate(
    {
      orderId,
      workflowStatus: {
        $in: [
          WORKFLOW_STATUS.DELIVERED_PENDING_CONFIRMATION,
          WORKFLOW_STATUS.OUT_FOR_DELIVERY_COURIER,
          WORKFLOW_STATUS.IN_TRANSIT,
        ],
      },
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.DELIVERED,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED),
        "deliveryConfirmedByCustomer.confirmed": true,
        "deliveryConfirmedByCustomer.confirmedAt": new Date(),
        "deliveryConfirmedByCustomer.confirmedVia": "admin_override",
        "deliveryConfirmedByCustomer.adminOverrideBy": adminId,
      },
    },
    { new: true },
  );

  if (!order) {
    const error = new Error("Order not eligible to be force-marked delivered");
    error.statusCode = 404;
    throw error;
  }

  emitOrderStatusUpdate(order.orderId, { workflowStatus: WORKFLOW_STATUS.DELIVERED }, order.customer);
  return order;
}

/**
 * Ecommerce counterpart to orderWorkflowService.sellerAcceptAtomic — same
 * SELLER_PENDING guard conditions, but transitions to SELLER_ACCEPTED (no
 * delivery-search/rider-broadcast machinery) and then hands off to the
 * Shiprocket push/AWB/pickup sequence.
 */
export async function sellerAcceptAtomic(sellerId, orderId) {
  orderId = await requireCanonicalOrderId(orderId);
  const now = new Date();

  const updated = await Order.findOneAndUpdate(
    {
      orderId,
      seller: sellerId,
      workflowVersion: { $gte: 2 },
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
      sellerPendingExpiresAt: { $gt: now },
      $or: [{ paymentMode: { $ne: "ONLINE" } }, { paymentStatus: "PAID" }],
    },
    {
      $set: {
        workflowStatus: WORKFLOW_STATUS.SELLER_ACCEPTED,
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.SELLER_ACCEPTED),
        sellerAcceptedAt: now,
      },
      $unset: { expiresAt: 1 },
    },
    { new: true },
  );

  if (!updated) {
    const err = new Error("Order not available for acceptance or expired");
    err.statusCode = 409;
    throw err;
  }

  emitOrderStatusUpdate(
    updated.orderId,
    { workflowStatus: WORKFLOW_STATUS.SELLER_ACCEPTED },
    updated.customer,
  );

  // Fulfillment continues asynchronously to the caller — a Shiprocket
  // outage shouldn't fail the seller's "accept" action itself. Failures
  // are logged; the order stays visibly at SELLER_ACCEPTED for retry.
  handleSellerAccept(updated).catch((error) => {
    logger.error(
      `[shiprocketWorkflowService] Fulfillment kickoff failed for ${updated.orderId}: ${error.message}`,
    );
  });

  return updated;
}
