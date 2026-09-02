import nodemailer from "nodemailer";
import logger from "./logger.js";
import Setting from "../models/setting.js";
import { buildKey, getOrSet, getTTL } from "./cacheService.js";

let cachedTransporter = null;

async function getEmailBranding() {
  try {
    // Separate cache entry (not the same key as the public /settings endpoint,
    // which caches a much larger field set) but still under "platform:settings:*"
    // so it's invalidated whenever settingsController updates settings.
    const cacheKey = buildKey("platform", "settings", "email-branding");
    const settings = await getOrSet(
      cacheKey,
      async () => {
        const existing = await Setting.findOne({
          $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
        })
          .select("appName logoUrl")
          .lean();
        return existing || null;
      },
      getTTL("settings"),
    );

    return {
      appName: settings?.appName || "Appzeto",
      logoUrl: settings?.logoUrl || "",
    };
  } catch (error) {
    logger.error("Failed to load branding for email", error);
    return { appName: "Appzeto", logoUrl: "" };
  }
}

export function useRealEmailOTP() {
  return (
    process.env.USE_REAL_EMAIL_OTP === "true" ||
    process.env.USE_REAL_EMAIL_OTP === "1"
  );
}

function parseSmtpPort() {
  return parseInt(process.env.SMTP_PORT || "587", 10);
}

function parseSmtpSecure(port) {
  if (process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1") {
    return true;
  }

  if (process.env.SMTP_SECURE === "false" || process.env.SMTP_SECURE === "0") {
    return false;
  }

  return port === 465;
}

function getMailFrom() {
  const fromAddress = String(process.env.MAIL_FROM || "").trim();
  const fromName = String(process.env.MAIL_FROM_NAME || "").trim();

  if (!fromAddress) {
    const error = new Error("MAIL_FROM is required for email OTP delivery");
    error.statusCode = 500;
    throw error;
  }

  return fromName ? `${fromName} <${fromAddress}>` : fromAddress;
}

function getTransportConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = parseSmtpPort();
  const secure = parseSmtpSecure(port);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  if (!host) {
    const error = new Error("SMTP_HOST is required for email OTP delivery");
    error.statusCode = 500;
    throw error;
  }

  if (!Number.isFinite(port) || port <= 0) {
    const error = new Error("SMTP_PORT must be a valid number");
    error.statusCode = 500;
    throw error;
  }

  if ((user && !pass) || (!user && pass)) {
    const error = new Error("SMTP_USER and SMTP_PASS must be provided together");
    error.statusCode = 500;
    throw error;
  }

  return {
    host,
    port,
    secure,
    ...(user && pass
      ? {
          auth: {
            user,
            pass,
          },
        }
      : {}),
  };
}

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(getTransportConfig());
  }

  return cachedTransporter;
}

export async function sendSellerVerificationOtpEmail({
  email,
  otp,
  expiresInMinutes,
}) {
  if (!useRealEmailOTP()) {
    logger.info("Seller email OTP generated in mock mode", {
      email,
      otp,
      mode: "mock",
    });
    return {
      delivered: false,
      mode: "mock",
    };
  }

  const { appName, logoUrl } = await getEmailBranding();
  const transporter = getTransporter();
  await transporter.sendMail({
    from: getMailFrom(),
    to: email,
    subject: `Verify your seller signup email - ${appName}`,
    text: `${appName}: Your seller signup verification code is ${otp}. This code expires in ${expiresInMinutes} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        ${logoUrl
          ? `<img src="${logoUrl}" alt="${appName}" style="height: 40px; margin-bottom: 16px;" />`
          : `<p style="font-size: 18px; font-weight: 700; margin: 0 0 16px;">${appName}</p>`
        }
        <p>Your seller signup verification code is:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px;">${otp}</p>
        <p>This code expires in ${expiresInMinutes} minutes.</p>
      </div>
    `,
  });

  return {
    delivered: true,
    mode: "real",
  };
}

export function __resetEmailTransportForTests() {
  cachedTransporter = null;
}
