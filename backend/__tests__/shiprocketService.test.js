import { jest } from "@jest/globals";

/**
 * Verifies shiprocketService.js — the low-level Shiprocket API wrapper used
 * only for E-commerce order fulfillment. Redis is disabled so the auth-token
 * cache is a pass-through (each call re-authenticates), keeping assertions
 * simple and independent of caching behavior.
 */
process.env.REDIS_DISABLED = "true";
process.env.SHIPROCKET_EMAIL = "ops@example.com";
process.env.SHIPROCKET_PASSWORD = "secret";

const mockAxiosPost = jest.fn();
const mockAxiosCallable = jest.fn();
mockAxiosCallable.post = mockAxiosPost;

jest.unstable_mockModule("axios", () => ({
  default: mockAxiosCallable,
}));

const {
  getAuthToken,
  pushOrder,
  assignAwb,
  generatePickup,
  trackShipment,
} = await import("../app/services/shiprocketService.js");

describe("shiprocketService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ data: { token: "sr-token-123" } });
  });

  it("authenticates with SHIPROCKET_EMAIL/PASSWORD and returns the token", async () => {
    const token = await getAuthToken();
    expect(token).toBe("sr-token-123");
    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      { email: "ops@example.com", password: "secret" },
    );
  });

  it("pushOrder posts to /orders/create/adhoc with a bearer token", async () => {
    mockAxiosCallable.mockResolvedValue({ data: { order_id: 555, shipment_id: 999 } });

    const result = await pushOrder({ order_id: "ORD-1" });

    expect(result).toEqual({ order_id: 555, shipment_id: 999 });
    expect(mockAxiosCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: expect.stringContaining("/orders/create/adhoc"),
        data: { order_id: "ORD-1" },
        headers: { Authorization: "Bearer sr-token-123" },
      }),
    );
  });

  it("assignAwb posts shipment_id and optional courier_id", async () => {
    mockAxiosCallable.mockResolvedValue({ data: { awb_code: "AWB123" } });

    await assignAwb({ shipmentId: 999, courierId: 7 });

    expect(mockAxiosCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: expect.stringContaining("/courier/assign/awb"),
        data: { shipment_id: 999, courier_id: 7 },
      }),
    );
  });

  it("generatePickup posts the shipment_id as an array", async () => {
    mockAxiosCallable.mockResolvedValue({ data: { pickup_scheduled_date: "2026-01-01" } });

    await generatePickup({ shipmentId: 999 });

    expect(mockAxiosCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: expect.stringContaining("/courier/generate/pickup"),
        data: { shipment_id: [999] },
      }),
    );
  });

  it("trackShipment GETs /courier/track/awb/:awb", async () => {
    mockAxiosCallable.mockResolvedValue({ data: { tracking_data: {} } });

    await trackShipment({ awbCode: "AWB123" });

    expect(mockAxiosCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "get",
        url: expect.stringContaining("/courier/track/awb/AWB123"),
      }),
    );
  });

  it("refreshes the token once and retries on a 401", async () => {
    const unauthorizedError = { response: { status: 401 } };
    mockAxiosCallable
      .mockRejectedValueOnce(unauthorizedError)
      .mockResolvedValueOnce({ data: { order_id: 1 } });
    mockAxiosPost.mockResolvedValue({ data: { token: "sr-token-refreshed" } });

    const result = await pushOrder({ order_id: "ORD-2" });

    expect(result).toEqual({ order_id: 1 });
    expect(mockAxiosCallable).toHaveBeenCalledTimes(2);
    // Second attempt uses the refreshed token.
    expect(mockAxiosCallable).toHaveBeenLastCalledWith(
      expect.objectContaining({ headers: { Authorization: "Bearer sr-token-refreshed" } }),
    );
  });

  it("throws a clear error when credentials are not configured", async () => {
    delete process.env.SHIPROCKET_EMAIL;
    await expect(getAuthToken({ forceRefresh: true })).rejects.toThrow(/credentials not configured/);
    process.env.SHIPROCKET_EMAIL = "ops@example.com";
  });
});
