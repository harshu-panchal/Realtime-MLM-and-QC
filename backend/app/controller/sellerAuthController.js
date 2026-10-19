import Seller from "../models/seller.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import handleResponse from "../utils/helper.js";
import { submitBusinessTypeChangeRequest } from "../services/admin/sellerBusinessTypeService.js";
import {
    issueSellerVerificationOtp,
    verifySellerOtpCode,
    verifySellerVerificationToken,
    issueSellerResetOtp,
    verifySellerResetOtpCode,
} from "../services/sellerVerificationService.js";
import { uploadToCloudinary } from "../services/mediaService.js";
import { placeInTree, processBinaryCommission } from "../services/mlmService.js";
import Setting from "../models/setting.js";
import User from "../models/customer.js";

/* ===============================
   Utils
================================ */

const generateToken = (seller) =>
    jwt.sign({ id: seller._id, role: "seller" }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "30d",
    });

const SELLER_DOCUMENT_FIELDS = {
    tradeLicense: "Trade License",
    gstCertificate: "GST Certificate",
    idProof: "ID Proof",
};

const REQUIRED_SELLER_DOCUMENT_FIELDS = Object.keys(SELLER_DOCUMENT_FIELDS);

const VALID_BUSINESS_TYPES = ["quick_commerce", "ecommerce"];

const parseDocumentsPayload = (documents) => {
    if (!documents) {
        return {};
    }

    if (typeof documents === "string") {
        try {
            return JSON.parse(documents);
        } catch {
            return {};
        }
    }

    if (typeof documents === "object") {
        return documents;
    }

    return {};
};

const isValidUploadedDocumentReference = (value) => {
    const normalized = String(value || "").trim();
    return /^https?:\/\//i.test(normalized);
};

const resolveSellerDocuments = (body = {}, parsedDocuments = {}) => {
    const resolved = { ...(parsedDocuments || {}) };

    const directFields = {
        tradeLicense: body.tradeLicenseUrl || body.tradeLicense,
        gstCertificate: body.gstCertificateUrl || body.gstCertificate,
        idProof: body.idProofUrl || body.idProof,
    };

    for (const [field, candidate] of Object.entries(directFields)) {
        const normalized = String(candidate || "").trim();
        if (normalized && /^https?:\/\//i.test(normalized)) {
            resolved[field] = normalized;
        }
    }

    return resolved;
};

const getMissingRequiredSellerDocuments = (documents = {}) =>
    REQUIRED_SELLER_DOCUMENT_FIELDS.filter(
        (fieldName) => !isValidUploadedDocumentReference(documents[fieldName]),
    );

/* ===============================
   SELLER SIGNUP
================================ */
export const signupSeller = async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            password,
            emailVerificationToken,
            phoneVerificationToken,
            shopName,
            category,
            businessType,
            description,
            address,
            locality,
            pincode,
            city,
            state,
            documents,
            lat,
            lng,
            radius
        } = req.body || {};

        // 1. Handle file uploads if they exist in req.files (multipart form)
        const documentFiles = req.files || [];
        const uploadedDocs = {};

        if (Array.isArray(documentFiles) && documentFiles.length > 0) {
            for (const file of documentFiles) {
                try {
                    const fieldName = file.fieldname;
                    if (fieldName && REQUIRED_SELLER_DOCUMENT_FIELDS.includes(fieldName)) {
                        const url = await uploadToCloudinary(file.buffer, "docs", {
                            mimeType: file.mimetype,
                        });
                        uploadedDocs[fieldName] = url;
                    }
                } catch (err) {
                    console.error("Failed to upload document to Cloudinary", err);
                }
            }
        }

        // Merge uploaded document URLs into body for resolveSellerDocuments
        const augmentedBody = {
            ...req.body,
            ...uploadedDocs
        };

        const parsedLat = lat !== undefined ? Number(lat) : undefined;
        const parsedLng = lng !== undefined ? Number(lng) : undefined;
        const parsedRadius = radius !== undefined ? Number(radius) : undefined;

        if (!name || !email || !phone || !password || !shopName) {
            return handleResponse(res, 400, "All fields are required");
        }

        if (!businessType || !VALID_BUSINESS_TYPES.includes(businessType)) {
            return handleResponse(
                res,
                400,
                "businessType is required and must be either 'quick_commerce' or 'ecommerce'",
            );
        }

        verifySellerVerificationToken({
            channel: "email",
            rawValue: email,
            token: emailVerificationToken,
        });
        verifySellerVerificationToken({
            channel: "phone",
            rawValue: phone,
            token: phoneVerificationToken,
        });

        // Validate coordinates and radius if provided
        if (lat !== undefined && (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90)) {
            return handleResponse(res, 400, "Invalid latitude");
        }
        if (lng !== undefined && (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180)) {
            return handleResponse(res, 400, "Invalid longitude");
        }
        if (radius !== undefined && (!Number.isFinite(parsedRadius) || parsedRadius < 1 || parsedRadius > 100)) {
            return handleResponse(res, 400, "Radius must be between 1 and 100 km");
        }

        const cleanPhone = phone ? phone.replace(/\D/g, "").slice(-10) : "";
        const cleanEmail = email ? email.toLowerCase().trim() : "";

        // Must be an existing User to become a Seller (handle with/without +91)
        const phoneVariants = cleanPhone ? [cleanPhone, `+91${cleanPhone}`, `91${cleanPhone}`] : [];
        const existingUser = await User.findOne({
            $or: [
                ...(phoneVariants.length > 0 ? [{ phone: { $in: phoneVariants } }] : []),
                ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ],
        }).lean();

        if (!existingUser) {
            return handleResponse(
                res,
                400,
                "Please register as a customer first. Only registered users are eligible to apply as a seller.",
                { requiresUserSignup: true }
            );
        }

        let seller = await Seller.findOne({ $or: [{ email }, { phone }] });

        if (seller) {
            return handleResponse(res, 400, "Seller with this email or phone already exists");
        }

        const setting = await Setting.findOne().lean();
        const feeAmount = Number(setting?.vendorRegistrationFee ?? 1000);
        let paymentInfo = { status: "exempt", amount: 0 };

        if (feeAmount > 0) {
            const { paymentToken } = req.body;
            if (!paymentToken) {
                return handleResponse(
                    res,
                    400,
                    "Onboarding fee payment is mandatory. Please complete payment through Razorpay."
                );
            }
            try {
                const decoded = jwt.verify(paymentToken, process.env.JWT_SECRET);
                if (!decoded.paid || decoded.type !== "onboarding_fee") {
                    throw new Error("Invalid payment token payload");
                }
                paymentInfo = {
                    status: "completed",
                    amount: feeAmount,
                    razorpayOrderId: decoded.razorpayOrderId,
                    razorpayPaymentId: decoded.razorpayPaymentId,
                    paidAt: new Date(),
                };
            } catch (err) {
                return handleResponse(
                    res,
                    400,
                    "Payment verification failed or expired. Please complete payment again."
                );
            }
        }

        const parsedDocuments = parseDocumentsPayload(documents);
        const sellerDocuments = resolveSellerDocuments(augmentedBody, parsedDocuments);
        const missingRequiredDocuments = getMissingRequiredSellerDocuments(
            sellerDocuments || {}
        );

        if (missingRequiredDocuments.length > 0) {
            const readableMissing = missingRequiredDocuments
                .map((field) => SELLER_DOCUMENT_FIELDS[field] || field)
                .join(", ");
            return handleResponse(
                res,
                400,
                `All required documents must be uploaded: ${readableMissing}`
            );
        }

        const sellerData = {
            name,
            email,
            phone,
            password,
            shopName,
            category,
            businessType,
            description,
            address,
            locality,
            pincode,
            city,
            state,
            documents: sellerDocuments,
            onboardingPayment: paymentInfo,
            applicationStatus: "pending",
            isVerified: false,
            emailVerified: true,
            phoneVerified: true,
            isActive: false,
        };

        if (parsedLat !== undefined && parsedLng !== undefined) {
            sellerData.location = {
                type: "Point",
                coordinates: [parsedLng, parsedLat],
            };
        }

        if (parsedRadius !== undefined) {
            sellerData.serviceRadius = parsedRadius;
        }

        const fcmTokenInput = String(req.body.fcmToken || req.body.token || "").trim();
        const platformInput = String(req.body.platform || "web").trim().toLowerCase();
        if (fcmTokenInput) {
            if (platformInput === "web") {
                sellerData.fcmTokenWeb = fcmTokenInput;
            } else {
                sellerData.fcmToken = fcmTokenInput;
            }
        }

        seller = await Seller.create(sellerData);

        if (fcmTokenInput) {
            try {
                const PushToken = (await import("../modules/notifications/token.model.js")).default;
                await PushToken.findOneAndUpdate(
                    { token: fcmTokenInput },
                    {
                        $set: {
                            userId: seller._id,
                            role: "seller",
                            userModel: "Seller",
                            token: fcmTokenInput,
                            platform: ["web", "app", "ios", "android"].includes(platformInput) ? platformInput : (platformInput === "web" ? "web" : "app"),
                            isActive: true,
                            lastUsedAt: new Date(),
                        },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
            } catch (err) {
                console.warn("Failed to register PushToken in seller signup:", err.message);
            }
        }

        try {
            await placeInTree({
                entityId: seller._id,
                entityType: "Seller",
                sponsorId: req.body.sponsorId || req.body.referralCode || null,
            });
            // Source 1: Vendor Registration Fee (Dynamic from Setting)
            const setting = await Setting.findOne().lean();
            const defaultFee = setting?.vendorRegistrationFee ?? 1000;
            const feeAmount = req.body.registrationFee ? Number(req.body.registrationFee) : defaultFee;

            await processBinaryCommission({
                entityId: seller._id,
                entityType: "Seller",
                source: "Vendor Registration Fee",
                amount: feeAmount
            });
        } catch (e) {
            console.error("Failed to place Seller in MLM tree or process commission:", e);
            console.error("Failed to place Seller in MLM tree or process commission:", e);
        }

        return handleResponse(res, 201, "Seller registered successfully", {
            seller,
            applicationStatus: "pending",
            requiresApproval: true,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   REQUEST BUSINESS TYPE CHANGE (Seller)
================================ */
export const requestBusinessTypeChange = async (req, res) => {
    try {
        const { requestedType, reason } = req.body || {};
        const seller = await submitBusinessTypeChangeRequest({
            sellerId: req.user.id,
            requestedType,
            reason,
        });

        if (!seller) {
            return handleResponse(res, 404, "Seller not found");
        }

        return handleResponse(res, 200, "Business type change request submitted", seller);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const sendSellerSignupOtp = async (req, res) => {
    try {
        const { channel, email, phone, value } = req.body || {};
        const targetValue =
            channel === "email"
                ? email || value
                : channel === "phone"
                    ? phone || value
                    : value;

        const result = await issueSellerVerificationOtp({
            channel,
            rawValue: targetValue,
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "OTP sent successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const verifySellerSignupOtp = async (req, res) => {
    try {
        const { channel, email, phone, value, otp } = req.body || {};
        const targetValue =
            channel === "email"
                ? email || value
                : channel === "phone"
                    ? phone || value
                    : value;

        const result = await verifySellerOtpCode({
            channel,
            rawValue: targetValue,
            otp,
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "OTP verified successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   SELLER LOGIN
================================ */
export const loginSeller = async (req, res) => {
    try {
        const { email, phone, emailOrPhone, password } = req.body;
        const identifier = emailOrPhone || email || phone;

        if (!identifier || !password) {
            return handleResponse(res, 400, "Email/Phone and password are required");
        }

        // Include password for comparison
        const query = identifier.includes("@")
            ? { email: identifier.toLowerCase() }
            : { phone: identifier.replace(/\D/g, "") };

        const seller = await Seller.findOne(query).select("+password");

        if (!seller) {
            return handleResponse(res, 404, "Seller not found");
        }

        let isMatch = await seller.comparePassword(password);

        if (!isMatch) {
            // Check if user has updated password in User account
            const user = await User.findOne(query).select("+password");
            if (user && user.password) {
                const userMatch = await bcrypt.compare(password, user.password);
                if (userMatch) {
                    isMatch = true;
                    // Sync seller password with user password
                    seller.password = password;
                    await seller.save();
                }
            }
        }

        if (!isMatch) {
            return handleResponse(res, 401, "Invalid credentials");
        }

        const applicationStatus =
            seller.applicationStatus || (seller.isVerified ? "approved" : "pending");
        const isApproved =
            seller.isVerified === true &&
            seller.isActive === true &&
            applicationStatus === "approved";

        if (!isApproved) {
            let approvalMessage = "Your seller account is pending admin approval.";
            if (applicationStatus === "suspended") {
                approvalMessage = `Your seller account has been suspended by Admin. Reason: ${seller.rejectionReason || "Policy violation"}`;
            } else if (applicationStatus === "rejected") {
                approvalMessage = "Your seller application was rejected. Please contact support.";
            }

            return handleResponse(res, 403, approvalMessage, {
                applicationStatus,
                isVerified: seller.isVerified === true,
                isActive: seller.isActive === true,
                rejectionReason: seller.rejectionReason || "",
            });
        }

        seller.lastLogin = new Date();
        
        // Save FCM token if passed in login
        const fcmTokenInput = String(req.body.fcmToken || req.body.token || "").trim();
        const platformInput = String(req.body.platform || "web").trim().toLowerCase();
        if (fcmTokenInput) {
            if (platformInput === "web") {
                seller.fcmTokenWeb = fcmTokenInput;
            } else {
                seller.fcmToken = fcmTokenInput;
            }
            try {
                const PushToken = (await import("../modules/notifications/token.model.js")).default;
                await PushToken.findOneAndUpdate(
                    { token: fcmTokenInput },
                    {
                        $set: {
                            userId: seller._id,
                            role: "seller",
                            userModel: "Seller",
                            token: fcmTokenInput,
                            platform: ["web", "app", "ios", "android"].includes(platformInput) ? platformInput : (platformInput === "web" ? "web" : "app"),
                            isActive: true,
                            lastUsedAt: new Date(),
                        },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
            } catch (err) {
                console.warn("Failed to register PushToken in seller login:", err.message);
            }
        }

        await seller.save();

        const token = generateToken(seller);

        return handleResponse(res, 200, "Login successful", {
            token,
            seller,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};


/* ===============================
   SELLER FORGOT PASSWORD
================================ */

export const sendSellerResetOtp = async (req, res) => {
    try {
        const { channel, rawValue } = req.body;
        if (!channel || !rawValue) {
            return handleResponse(res, 400, "Channel and target value are required");
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const result = await issueSellerResetOtp({ channel, rawValue, ipAddress });

        return handleResponse(res, 200, "Reset OTP sent successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const verifySellerResetOtp = async (req, res) => {
    try {
        const { channel, rawValue, otp } = req.body;
        if (!channel || !rawValue || !otp) {
            return handleResponse(res, 400, "Channel, target, and OTP are required");
        }

        const ipAddress = req.ip || req.connection.remoteAddress;
        const result = await verifySellerResetOtpCode({ channel, rawValue, otp, ipAddress });

        return handleResponse(res, 200, "OTP verified successfully", result);
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

export const resetSellerPassword = async (req, res) => {
    try {
        const { channel, rawValue, token, newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return handleResponse(res, 400, "Password must be at least 8 characters long");
        }

        // Verify the token
        verifySellerVerificationToken({ channel, rawValue, token, purpose: "seller_reset" });

        // Find the seller
        const query = channel === "email" ? { email: rawValue.toLowerCase() } : { phone: rawValue };
        const seller = await Seller.findOne(query);

        if (!seller) {
            return handleResponse(res, 404, "Seller not found");
        }

        // Update password (pre-save hook will hash it)
        seller.password = newPassword;
        await seller.save();

        return handleResponse(res, 200, "Password reset successfully");
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   SELLER CHECK EXISTS
================================ */
export const checkSellerExists = async (req, res) => {
    try {
        const { email, phone } = req.body;
        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone: phone.replace(/\D/g, "") });

        if (query.length === 0) {
            return handleResponse(res, 400, "Email or phone is required");
        }

        const seller = await Seller.findOne({ $or: query }).select("_id").lean();

        const userQuery = [];
        if (email) userQuery.push({ email: email.toLowerCase() });
        if (phone) {
            const clean = phone.replace(/\D/g, "").slice(-10);
            userQuery.push({ phone: { $in: [clean, `+91${clean}`, `91${clean}`] } });
        }
        const user = await User.findOne({ $or: userQuery }).select("_id").lean();

        return handleResponse(res, 200, "Check completed", {
            exists: !!seller,
            userExists: !!user,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   SELLER ONBOARDING PAYMENT (Razorpay)
================================ */
export const createSellerOnboardingOrder = async (req, res) => {
    try {
        const { email, phone } = req.body;
        if (!email && !phone) {
            return handleResponse(res, 400, "Email or phone is required");
        }

        const query = [];
        if (email) query.push({ email: email.toLowerCase() });
        if (phone) query.push({ phone });

        const existingSeller = await Seller.findOne({ $or: query });
        if (existingSeller) {
            return handleResponse(res, 400, "Seller with this email or phone is already registered. Please login instead.");
        }

        const setting = await Setting.findOne().lean();
        const feeAmount = Number(setting?.vendorRegistrationFee ?? 1000);

        if (feeAmount <= 0) {
            return handleResponse(res, 200, "Onboarding fee is 0, payment not required", {
                exempt: true,
                amount: 0,
            });
        }

        const { RazorpayAdapter } = await import("../services/payment/providers/razorpay.adapter.js");
        const adapter = new RazorpayAdapter();
        const merchantOrderId = `ONB_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        const result = await adapter.initiatePayment({
            merchantOrderId,
            amountPaise: Math.round(feeAmount * 100),
            redirectUrl: "",
        });

        return handleResponse(res, 200, "Onboarding order created", {
            razorpayOrderId: result.gatewayResponse?.razorpayOrderId,
            amount: feeAmount,
            currency: "INR",
            keyId: process.env.RAZORPAY_KEY_ID,
            merchantOrderId,
        });
    } catch (error) {
        console.error("Failed to create seller onboarding order:", error);
        return handleResponse(res, 500, error.message || "Failed to initialize payment");
    }
};

export const verifySellerOnboardingPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

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

        const token = jwt.sign(
            {
                paid: true,
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                type: "onboarding_fee",
            },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        return handleResponse(res, 200, "Payment verified successfully", {
            verified: true,
            paymentToken: token,
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
        });
    } catch (error) {
        console.error("Payment verification failed:", error);
        return handleResponse(res, 500, error.message || "Payment verification failed");
    }
};
