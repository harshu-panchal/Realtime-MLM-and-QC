import express from "express";
import { handleShiprocketTrackingWebhook } from "../controller/shiprocketOrderController.js";

const router = express.Router();

/**
 * Shiprocket tracking webhook — registered as the callback URL in
 * Shiprocket's panel. See shiprocketOrderController.js for the shared-secret
 * check (Shiprocket doesn't sign payloads, unlike Razorpay).
 */
router.post("/webhook/tracking", express.json(), handleShiprocketTrackingWebhook);

export default router;
