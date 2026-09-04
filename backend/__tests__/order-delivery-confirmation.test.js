import { jest } from "@jest/globals";

/**
 * Verifies shiprocketWorkflowService's delivery-confirmation pair:
 *  - confirmDeliveryByCustomer only succeeds from DELIVERED_PENDING_CONFIRMATION
 *    and only for the order's own customer.
 *  - forceMarkDelivered is the admin fallback for customers who never confirm,
 *    and records confirmedVia: "admin_override".
 */

const mockOrderFindOneAndUpdate = jest.fn();
const mockEmitOrderStatusUpdate = jest.fn();

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: { findOneAndUpdate: mockOrderFindOneAndUpdate },
}));

jest.unstable_mockModule("../app/services/orderSocketEmitter.js", () => ({
  emitOrderStatusUpdate: mockEmitOrderStatusUpdate,
}));

const { confirmDeliveryByCustomer, forceMarkDelivered } = await import(
  "../app/services/shiprocketWorkflowService.js"
);

describe("confirmDeliveryByCustomer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("transitions DELIVERED_PENDING_CONFIRMATION -> DELIVERED for the order's own customer", async () => {
    mockOrderFindOneAndUpdate.mockResolvedValue({
      orderId: "ORD-1",
      customer: "customer-1",
      workflowStatus: "DELIVERED",
    });

    const result = await confirmDeliveryByCustomer({ orderId: "ORD-1", customerId: "customer-1" });

    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      {
        orderId: "ORD-1",
        customer: "customer-1",
        workflowStatus: "DELIVERED_PENDING_CONFIRMATION",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          workflowStatus: "DELIVERED",
          "deliveryConfirmedByCustomer.confirmed": true,
          "deliveryConfirmedByCustomer.confirmedVia": "customer",
        }),
      }),
      { new: true },
    );
    expect(result.workflowStatus).toBe("DELIVERED");
    expect(mockEmitOrderStatusUpdate).toHaveBeenCalledWith(
      "ORD-1",
      { workflowStatus: "DELIVERED" },
      "customer-1",
    );
  });

  it("throws 409 when the order isn't awaiting confirmation or belongs to another customer", async () => {
    mockOrderFindOneAndUpdate.mockResolvedValue(null);

    await expect(
      confirmDeliveryByCustomer({ orderId: "ORD-1", customerId: "someone-else" }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("forceMarkDelivered", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marks delivered from any in-transit-ish status and records admin_override", async () => {
    mockOrderFindOneAndUpdate.mockResolvedValue({
      orderId: "ORD-2",
      customer: "customer-1",
      workflowStatus: "DELIVERED",
    });

    await forceMarkDelivered({ orderId: "ORD-2", adminId: "admin-1" });

    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      {
        orderId: "ORD-2",
        workflowStatus: {
          $in: ["DELIVERED_PENDING_CONFIRMATION", "OUT_FOR_DELIVERY_COURIER", "IN_TRANSIT"],
        },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          workflowStatus: "DELIVERED",
          "deliveryConfirmedByCustomer.confirmedVia": "admin_override",
          "deliveryConfirmedByCustomer.adminOverrideBy": "admin-1",
        }),
      }),
      { new: true },
    );
  });

  it("throws 404 when the order isn't in an eligible state", async () => {
    mockOrderFindOneAndUpdate.mockResolvedValue(null);

    await expect(
      forceMarkDelivered({ orderId: "ORD-2", adminId: "admin-1" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
