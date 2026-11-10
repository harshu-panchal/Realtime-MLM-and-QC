import Joi from "joi";

export const sendSignupOtpSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  phone: Joi.string().trim().min(7).max(24).required(),
  aadharNumber: Joi.string()
    .replace(/\s/g, "")
    .pattern(/^\d{12}$/)
    .required()
    .messages({
      "any.required": "Aadhar number is required",
      "string.empty": "Aadhar number is required",
      "string.pattern.base": "Aadhar number must be 12 digits",
    }),
  referralCode: Joi.string().trim().uppercase().optional().allow(''),
  fcmToken: Joi.string().trim().optional().allow('', null),
  token: Joi.string().trim().optional().allow('', null),
  platform: Joi.string().trim().valid("web", "app", "ios", "android").optional(),
});

export const sendLoginOtpSchema = Joi.object({
  phone: Joi.string().trim().min(7).max(24).required(),
  fcmToken: Joi.string().trim().optional().allow('', null),
  token: Joi.string().trim().optional().allow('', null),
  platform: Joi.string().trim().valid("web", "app", "ios", "android").optional(),
});

export const verifyOtpSchema = Joi.object({
  phone: Joi.string().trim().min(7).max(24).required(),
  otp: Joi.string().trim().pattern(/^\d{4,8}$/).required(),
  fcmToken: Joi.string().trim().optional().allow('', null),
  token: Joi.string().trim().optional().allow('', null),
  platform: Joi.string().trim().valid("web", "app", "ios", "android").optional(),
});

export function validateSchema(schema, payload) {
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (!error) return value;
  const err = new Error(error.details.map((item) => item.message).join("; "));
  err.statusCode = 400;
  throw err;
}
