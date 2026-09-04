import { jest } from "@jest/globals";

/**
 * Verifies shiprocketWorkflowService.processTrackingWebhook: synthetic
 * Shiprocket tracking webhook payloads should append to trackingHistory
 * regardless of status, and map recognized statuses to WORKFLOW_STATUS —
 * critically, "Delivered" must map to DELIVERED_PENDING_CONFIRMATION, never
 * straight to DELIVERED (that requires customer confirmation or an admin
 * override — see order-delivery-confirmation.test.js).
 */

const mockOrderFindOne = jest.fn();
const mockOrderFindOneAndUpdate = jest.fn();
const mockEmitOrderStatusUpdate = jest.fn();

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    findOne: mockOrderFindOne,
    findOneAndUpdate: mockOrderFindOneAndUpdate,
  },
}));

jest.unstable_mockModule("../app/services/orderSocketEmitter.js", () => ({
  emitOrderStatusUpdate: mockEmitOrderStatusUpdate,
}));

const { processTrackingWebhook } = await import("../app/services/shiprocketWorkflowService.js");

const EXISTING_ORDER = { _id: "order-doc-1", orderId: "ORD-1", customer: "customer-1", shipment: {} };

describe("shiprocketWorkflowService.processTrackingWebhook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderFindOne.mockResolvedValue(EXISTING_ORDER);
    mockOrderFindOneAndUpdate.mockResolvedValue({ ...EXISTING_ORDER, workflowStatus: "SHIPPED" });
  });

  it("looks the order up by AWB and appends the raw event to trackingHistory", async () => {
    await processTrackingWebhook({ awb: "AWB1", current_status: "Shipped", location: "Bengaluru Hub" });

    expect(mockOrderFindOne).toHaveBeenCalledWith({ "shipment.awbCode": "AWB1" });
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "order-doc-1" },
      expect.objectContaining({
        $push: {
          "shipment.trackingHistory": expect.objectContaining({
            status: "Shipped",
            location: "Bengaluru Hub",
          }),
        },
      }),
      { new: true },
    );
  });

  it("maps 'Shipped' to WORKFLOW_STATUS.SHIPPED", async () => {
    await processTrackingWebhook({ awb: "AWB1", current_status: "Shipped" });

    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ workflowStatus: "SHIPPED" }) }),
      { new: true },
    );
  });

  it("maps 'Delivered' to DELIVERED_PENDING_CONFIRMATION, never straight to DELIVERED", async () => {
    await processTrackingWebhook({ awb: "AWB1", current_status: "Delivered" });

    const [, update] = mockOrderFindOneAndUpdate.mock.calls[0];
    expect(update.$set.workflowStatus).toBe("DELIVERED_PENDING_CONFIRMATION");
    expect(update.$set.workflowStatus).not.toBe("DELIVERED");
  });

  it("still records unrecognized statuses in history without changing workflowStatus", async () => {
    await processTrackingWebhook({ awb: "AWB1", current_status: "Some Unknown Milestone" });

    const [, update] = mockOrderFindOneAndUpdate.mock.calls[0];
    expect(update.$push["shipment.trackingHistory"].status).toBe("Some Unknown Milestone");
    expect(update.$set.workflowStatus).toBeUndefined();
  });

  it("falls back to looking the order up by shiprocket order_id when awb is absent", async () => {
    await processTrackingWebhook({ order_id: "SR-999", current_status: "In Transit" });

    expect(mockOrderFindOne).toHaveBeenCalledWith({ "shipment.shiprocketOrderId": "SR-999" });
  });

  it("throws a 404 when no order matches", async () => {
    mockOrderFindOne.mockResolvedValue(null);

    await expect(
      processTrackingWebhook({ awb: "UNKNOWN-AWB", current_status: "Shipped" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
