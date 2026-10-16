import Customer from "../models/customer.js";
import Setting from "../models/setting.js";
import Transaction from "../models/transaction.js";
import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import {
    issueCustomerOtp,
    sanitizeCustomer,
    verifyCustomerOtpCode,
} from "../services/otpAuthService.js";
import {
    sendLoginOtpSchema,
    sendSignupOtpSchema,
    validateSchema,
    verifyOtpSchema,
} from "../validation/customerAuthValidation.js";

const generateToken = (customer) =>
    jwt.sign(
        { id: customer._id, role: "customer" },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
    );

/* ===============================
   SIGNUP – Send OTP
================================ */
export const signupCustomer = async (req, res) => {
    try {
        const payload = validateSchema(sendSignupOtpSchema, req.body || {});

        await issueCustomerOtp({
            name: payload.name,
            rawPhone: payload.phone,
            flow: "signup",
            referralCode: payload.referralCode,
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "If the number is eligible, OTP has been sent");
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   LOGIN – Send OTP
================================ */
export const loginCustomer = async (req, res) => {
    try {
        const payload = validateSchema(sendLoginOtpSchema, req.body || {});

        await issueCustomerOtp({
            rawPhone: payload.phone,
            flow: "login",
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "If the number is eligible, OTP has been sent");
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   VERIFY OTP – Login / Signup
================================ */
export const verifyCustomerOTP = async (req, res) => {
    try {
        const payload = validateSchema(verifyOtpSchema, req.body || {});
        const customer = await verifyCustomerOtpCode({
            rawPhone: payload.phone,
            otp: payload.otp,
            ipAddress: req.ip,
        });
        const token = generateToken(customer);

        // Save FCM token if passed in login/signup request
        const fcmTokenInput = String(req.body.fcmToken || req.body.token || "").trim();
        const platformInput = String(req.body.platform || "web").trim().toLowerCase();
        if (fcmTokenInput) {
            const isWeb = platformInput === "web";
            const updateFields = isWeb ? { fcmTokenWeb: fcmTokenInput } : { fcmToken: fcmTokenInput };
            await Customer.findByIdAndUpdate(customer._id, { $set: updateFields });
            try {
                const PushToken = (await import("../modules/notifications/token.model.js")).default;
                await PushToken.findOneAndUpdate(
                    { token: fcmTokenInput },
                    {
                        $set: {
                            userId: customer._id,
                            role: "customer",
                            userModel: "User",
                            token: fcmTokenInput,
                            platform: ["web", "app", "ios", "android"].includes(platformInput) ? platformInput : (isWeb ? "web" : "app"),
                            isActive: true,
                            lastUsedAt: new Date(),
                        },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
            } catch (err) {
                console.warn("Failed to register PushToken in customer auth:", err.message);
            }
        }

        return handleResponse(
            res,
            200,
            "Login successful",
            {
                token,
                customer: sanitizeCustomer(customer),
            }
        );
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   GET PROFILE
================================ */
export const getCustomerProfile = async (req, res) => {
    try {
        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }
        return handleResponse(res, 200, "Profile fetched successfully", customer);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   UPDATE PROFILE
================================ */
export const updateCustomerProfile = async (req, res) => {
    try {
        const { name, email, phone, bio, addresses } = req.body;

        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }

        if (name) customer.name = name;
        if (email !== undefined) customer.email = email;
        if (bio !== undefined) customer.bio = bio;
        if (addresses) customer.addresses = addresses;

        if (phone && phone !== customer.phone) {
            const existingPhone = await Customer.findOne({ phone, _id: { $ne: req.user.id } });
            if (existingPhone) {
                return handleResponse(res, 400, "Phone number is already in use");
            }
            customer.phone = phone;
        }

        await customer.save();

        return handleResponse(res, 200, "Profile updated successfully", customer);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   GET WALLET TRANSACTIONS
================================ */
export const getCustomerTransactions = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { page = 1, limit = 20 } = req.query;
        const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
        const perPage = Math.min(50, Math.max(1, parseInt(limit, 10)));

        const [transactions, total] = await Promise.all([
            Transaction.find({ user: customerId, userModel: "User" })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(perPage)
                .populate("order", "orderId")
                .lean(),
            Transaction.countDocuments({ user: customerId, userModel: "User" }),
        ]);

        const items = transactions.map((t) => ({
            _id: t._id,
            type: t.type === "Refund" ? "credit" : "debit",
            title: t.type === "Refund" ? "Refund" : t.type,
            amount: Math.abs(t.amount),
            date: t.createdAt,
            reference: t.reference,
            orderId: t.order?.orderId,
        }));

        return handleResponse(res, 200, "Transactions fetched", {
            items,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / perPage) || 1,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   DELETE ACCOUNT
================================ */
export const deleteCustomerAccount = async (req, res) => {
    try {
        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }

        customer.isActive = false;
        await customer.save();

        return handleResponse(res, 200, "Account deleted successfully");
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   WEEKLY SUBSCRIPTION (Saturday-to-Saturday)
================================ */

/**
 * Calculates next Saturday 12:00 PM cutoff.
 * If today is Saturday before 12:00 PM, next cutoff is today 12:00 PM.
 * If today is Saturday after 12:00 PM, cutoff is next Saturday 12:00 PM.
 */
export const calculateNextSaturdayNoon = () => {
    const now = new Date();
    const result = new Date(now);
    const day = now.getDay(); // 0 is Sunday, 6 is Saturday
    let daysUntilSat = (6 - day + 7) % 7;

    // If today is Saturday
    if (day === 6) {
        // If past 12:00 PM noon, set to next Saturday (7 days)
        if (now.getHours() >= 12) {
            daysUntilSat = 7;
        }
    }
    result.setDate(now.getDate() + daysUntilSat);
    result.setHours(12, 0, 0, 0);
    return result;
};

export const createCustomerSubscriptionOrder = async (req, res) => {
    try {
        const { phone } = req.body;
        const targetPhone = phone || req.user?.phone;

        const setting = await Setting.findOne().lean();
        const feeAmount = Number(setting?.userWeeklySubscriptionFee ?? 50);

        if (feeAmount <= 0) {
            return handleResponse(res, 200, "Subscription fee is 0, payment not required", {
                exempt: true,
                amount: 0,
            });
        }

        const { RazorpayAdapter } = await import("../services/payment/providers/razorpay.adapter.js");
        const adapter = new RazorpayAdapter();
        const merchantOrderId = `CSUB_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        const result = await adapter.initiatePayment({
            merchantOrderId,
            amountPaise: Math.round(feeAmount * 100),
            redirectUrl: "",
        });

        return handleResponse(res, 200, "Subscription order created", {
            razorpayOrderId: result.gatewayResponse?.razorpayOrderId,
            amount: feeAmount,
            currency: "INR",
            keyId: process.env.RAZORPAY_KEY_ID,
            merchantOrderId,
            targetPhone,
            nextSaturdayCutoff: calculateNextSaturdayNoon(),
        });
    } catch (error) {
        console.error("Failed to create customer subscription order:", error);
        return handleResponse(res, 500, error.message || "Failed to initialize payment");
    }
};

export const verifyCustomerSubscriptionPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, phone, customerId } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return handleResponse(res, 400, "Payment verification parameters missing");
        }

        const crypto = (await import("crypto")).default;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keySecret) {
            return handleResponse(res, 500, "Payment gateway secret not configured");
        }

        const expectedSignature = crypto
            .createHmac("sha256", keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return handleResponse(res, 400, "Invalid payment signature");
        }

        const setting = await Setting.findOne().lean();
        const feeAmount = Number(setting?.userWeeklySubscriptionFee ?? 50);
        const expiresAt = calculateNextSaturdayNoon();

        // Update customer in database if customerId or phone is provided or authenticated
        const resolvedId = customerId || req.user?.id;
        let customer = null;
        if (resolvedId) {
            customer = await Customer.findById(resolvedId);
        } else if (phone) {
            const { normalizePhoneNumber } = await import("../utils/phone.js");
            const cleanPhone = normalizePhoneNumber(phone);
            customer = await Customer.findOne({
                $or: [
                    { phone: cleanPhone },
                    { phone: `+91${cleanPhone.replace(/^\+91/, '')}` },
                    { phone: cleanPhone.replace(/^\+91/, '') }
                ]
            });
        }

        if (customer) {
            customer.weeklySubscription = {
                status: "active",
                amount: feeAmount,
                paidAt: new Date(),
                expiresAt,
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                lastNotificationSentAt: null,
            };
            await customer.save();
        }

        const paymentToken = jwt.sign(
            {
                paid: true,
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                amount: feeAmount,
                expiresAt,
                type: "customer_weekly_subscription",
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        return handleResponse(res, 200, "Weekly subscription verified successfully", {
            verified: true,
            paymentToken,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            expiresAt,
            amount: feeAmount,
            customer: customer ? sanitizeCustomer(customer) : null,
        });
    } catch (error) {
        console.error("Subscription payment verification failed:", error);
        return handleResponse(res, 500, error.message || "Payment verification failed");
    }
};

export const getCustomerSubscriptionStatus = async (req, res) => {
    try {
        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }

        const setting = await Setting.findOne().lean();
        const currentFee = Number(setting?.userWeeklySubscriptionFee ?? 50);

        const now = new Date();
        const sub = customer.weeklySubscription || { status: "none" };
        const isExpired = sub.expiresAt && new Date(sub.expiresAt) < now;

        return handleResponse(res, 200, "Subscription status fetched", {
            status: isExpired ? "expired" : (sub.status || "none"),
            amount: sub.amount || currentFee,
            currentFee,
            expiresAt: sub.expiresAt,
            paidAt: sub.paidAt,
            nextSaturdayCutoff: calculateNextSaturdayNoon(),
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

