import handleResponse from "../utils/helper.js";
import {
  processTrackingWebhook,
  confirmDeliveryByCustomer,
  forceMarkDelivered,
} from "../services/shiprocketWorkflowService.js";
import { requireCanonicalOrderId } from "../utils/orderLookup.js";
import logger from "../services/logger.js";

/**
 * Shiprocket tracking webhook. Shared-secret auth via a custom header
 * (Shiprocket lets you configure an arbitrary token/secret when registering
 * a webhook URL in their panel) rather than HMAC — Shiprocket does not sign
 * webhook bodies the way Razorpay does.
 */
export const handleShiprocketTrackingWebhook = async (req, res) => {
  try {
    const expectedSecret = process.env.SHIPROCKET_WEBHOOK_SECRET;
    const providedSecret = req.headers["x-shiprocket-webhook-token"];

    if (expectedSecret && providedSecret !== expectedSecret) {
      logger.warn("[shiprocketOrderController] Webhook rejected: bad/missing token");
      return res.status(401).send("Unauthorized");
    }

    await processTrackingWebhook(req.body || {});
    return res.status(200).send("OK");
  } catch (error) {
    if (error.statusCode === 404) {
      // Unknown AWB/order — acknowledge so Shiprocket doesn't keep retrying
      // a webhook we can never resolve, but log for investigation.
      logger.warn(`[shiprocketOrderController] ${error.message}`);
      return res.status(200).send("OK");
    }
    logger.error(`[shiprocketOrderController] Webhook processing failed: ${error.message}`);
    return res.status(500).send("Internal Server Error");
  }
};

export const confirmOrderReceived = async (req, res) => {
  try {
    const orderId = await requireCanonicalOrderId(req.params.id);
    const order = await confirmDeliveryByCustomer({
      orderId,
      customerId: req.user.id,
    });
    return handleResponse(res, 200, "Delivery confirmed", order);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const forceOrderDelivered = async (req, res) => {
  try {
    const orderId = await requireCanonicalOrderId(req.params.id);
    const order = await forceMarkDelivered({
      orderId,
      adminId: req.user.id,
    });
    return handleResponse(res, 200, "Order marked as delivered", order);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};
