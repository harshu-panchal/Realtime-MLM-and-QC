import axios from "axios";
import { buildKey, getOrSet, getTTL, invalidate } from "./cacheService.js";
import logger from "./logger.js";

/**
 * Thin wrapper around Shiprocket's REST API (https://apiv2.shiprocket.in/v1/external).
 * Used only for E-commerce (nationwide) orders — Quick Commerce orders never
 * touch this file; see shiprocketWorkflowService.js for the branch point.
 *
 * Requires SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD in the environment. Base
 * URL is overridable via SHIPROCKET_BASE_URL for sandbox/staging use.
 */

function getBaseUrl() {
  return (process.env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in/v1/external").replace(
    /\/+$/,
    "",
  );
}

function getCredentials() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) {
    const error = new Error("Shiprocket credentials not configured (SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD)");
    error.statusCode = 500;
    throw error;
  }
  return { email, password };
}

async function fetchAuthToken() {
  const { email, password } = getCredentials();
  const response = await axios.post(`${getBaseUrl()}/auth/login`, { email, password });
  const token = response.data?.token;
  if (!token) {
    throw new Error("Shiprocket auth response did not include a token");
  }
  return token;
}

export async function getAuthToken({ forceRefresh = false } = {}) {
  const key = buildKey("shiprocket", "auth", "token");
  if (forceRefresh) {
    await invalidate(key);
  }
  return getOrSet(key, fetchAuthToken, getTTL("shiprocketToken"));
}

// Low-level request helper — the single seam tests mock to avoid real HTTP calls.
export async function shiprocketRequest(method, path, data) {
  const token = await getAuthToken();
  try {
    const response = await axios({
      method,
      url: `${getBaseUrl()}${path}`,
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (error) {
    // A 401 usually means the cached token expired early or was revoked —
    // refresh once and retry before giving up.
    if (error.response?.status === 401) {
      const freshToken = await getAuthToken({ forceRefresh: true });
      const retryResponse = await axios({
        method,
        url: `${getBaseUrl()}${path}`,
        data,
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      return retryResponse.data;
    }
    logger.error(`[shiprocketService] ${method.toUpperCase()} ${path} failed: ${error.message}`);
    throw error;
  }
}

/**
 * Push a new order to Shiprocket. `payload` follows Shiprocket's
 * /orders/create/adhoc shape — see buildOrderPayload in
 * shiprocketWorkflowService.js for how an internal Order document is mapped.
 */
export async function pushOrder(payload) {
  return shiprocketRequest("post", "/orders/create/adhoc", payload);
}

/** Assign an AWB (airway bill) — a specific courier, or let Shiprocket pick the best one. */
export async function assignAwb({ shipmentId, courierId } = {}) {
  const payload = { shipment_id: shipmentId };
  if (courierId) payload.courier_id = courierId;
  return shiprocketRequest("post", "/courier/assign/awb", payload);
}

/** Schedule a courier pickup for an already-AWB-assigned shipment. */
export async function generatePickup({ shipmentId } = {}) {
  return shiprocketRequest("post", "/courier/generate/pickup", { shipment_id: [shipmentId] });
}

/** Fetch the latest tracking status/history for a shipment by AWB code. */
export async function trackShipment({ awbCode } = {}) {
  return shiprocketRequest("get", `/courier/track/awb/${encodeURIComponent(awbCode)}`);
}
