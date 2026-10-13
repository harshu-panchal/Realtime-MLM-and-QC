/**
 * Joi schemas for delivery-partner-facing endpoints.
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const latitude = Joi.number().min(-90).max(90);
const longitude = Joi.number().min(-180).max(180);

export const updateLocationSchema = Joi.object({
  lat: latitude.required(),
  lng: longitude.required(),
  accuracy: Joi.number().min(0).optional(),
  heading: Joi.number().min(0).max(360).optional(),
  speed: Joi.number().min(0).optional(),
});

export const goOnlineSchema = Joi.object({
  lat: latitude.optional(),
  lng: longitude.optional(),
}).unknown(false);

export const completeDeliverySchema = Joi.object({
  otp: trimmedString.length(6).pattern(/^\d+$/).optional(),
  proofImageUrl: trimmedString.uri().optional(),
  notes: trimmedString.max(500).optional(),
});

export const submitCodCashSchema = Joi.object({
  amount: Joi.number().min(0).required(),
  notes: trimmedString.max(500).optional(),
});

export const withdrawalRequestSchema = Joi.object({
  amount: Joi.number().min(1).required(),
  notes: trimmedString.max(500).optional(),
});

export const updateProfileSchema = Joi.object({
  name: trimmedString.min(2).max(100).optional(),
  email: trimmedString.email().optional().allow("", null),
  address: trimmedString.max(300).optional().allow("", null),
  bloodGroup: trimmedString.max(10).optional().allow("", null),
  profileImage: trimmedString.uri().optional().allow("", null),
  phone: trimmedString
    .pattern(/^\+?\d{10,15}$/)
    .optional(),
  vehicleType: trimmedString
    .valid("bike", "scooter", "bicycle", "car", "cycle", "other")
    .optional(),
  vehicleNumber: trimmedString.max(20).optional(),
  drivingLicenseNumber: trimmedString.max(30).optional().allow("", null),
  currentArea: trimmedString.max(100).optional().allow("", null),
  isOnline: Joi.boolean().optional(),
});
