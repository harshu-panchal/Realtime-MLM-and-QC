import express from "express";
import {
    signupCustomer,
    loginCustomer,
    verifyCustomerOTP,
    getCustomerProfile,
    updateCustomerProfile,
    getCustomerTransactions,
    deleteCustomerAccount,
    createCustomerSubscriptionOrder,
    verifyCustomerSubscriptionPayment,
    getCustomerSubscriptionStatus,
} from "../controller/customerAuthController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import {
    authRouteRateLimiter,
    createContentLengthGuard,
    otpRouteRateLimiter,
} from "../middleware/securityMiddlewares.js";

import { registerPushToken } from "../modules/notifications/notification.controller.js";

const router = express.Router();
const smallAuthPayload = createContentLengthGuard(
    parseInt(process.env.AUTH_MAX_PAYLOAD_BYTES || "16384", 10),
    "Auth payload too large",
);
router.post("/send-signup-otp", authRouteRateLimiter, otpRouteRateLimiter, smallAuthPayload, signupCustomer);
router.post("/send-login-otp", authRouteRateLimiter, otpRouteRateLimiter, smallAuthPayload, loginCustomer);
router.post("/verify-otp", authRouteRateLimiter, otpRouteRateLimiter, smallAuthPayload, verifyCustomerOTP);

// Weekly Subscription routes (Razorpay)
router.post("/subscription/create-order", createCustomerSubscriptionOrder);
router.post("/subscription/verify-payment", verifyCustomerSubscriptionPayment);
router.get("/subscription/status", verifyToken, getCustomerSubscriptionStatus);

// FCM push token registration
router.post("/fcm-token", verifyToken, registerPushToken);

// Profile routes
router.get("/profile", verifyToken, getCustomerProfile);
router.put("/profile", verifyToken, updateCustomerProfile);
router.delete("/delete-account", verifyToken, deleteCustomerAccount);

// Wallet
router.get("/transactions", verifyToken, getCustomerTransactions);

export default router;
