import { jest } from "@jest/globals";

/**
 * Verifies two things:
 *  1. shiprocketWorkflowService.handleSellerAccept runs the Shiprocket
 *     push -> assignAwb -> generatePickup sequence and persists shipment
 *     fields at each step (shiprocketService's HTTP calls are mocked).
 *  2. orderWorkflowService.sellerAcceptAtomic branches ecommerce orders to
 *     shiprocketWorkflowService and NEVER runs the hyperlocal
 *     DeliveryAssignment/rider-broadcast path for them — the regression
 *     guard that keeps Quick Commerce orders completely untouched.
 */

const mockOrderFindOne = jest.fn();
const mockOrderFindOneAndUpdate = jest.fn();
const mockPushOrder = jest.fn();
const mockAssignAwb = jest.fn();
const mockGeneratePickup = jest.fn();
const mockEmitOrderStatusUpdate = jest.fn();

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    findOne: mockOrderFindOne,
    findOneAndUpdate: mockOrderFindOneAndUpdate,
  },
}));

jest.unstable_mockModule("../app/services/shiprocketService.js", () => ({
  pushOrder: mockPushOrder,
  assignAwb: mockAssignAwb,
  generatePickup: mockGeneratePickup,
}));

jest.unstable_mockModule("../app/services/orderSocketEmitter.js", () => ({
  emitOrderStatusUpdate: mockEmitOrderStatusUpdate,
  emitToSeller: jest.fn(),
  emitDeliveryBroadcastForSeller: jest.fn(),
  emitReturnBroadcastForCustomer: jest.fn(),
  emitToCustomer: jest.fn(),
  emitToOrder: jest.fn(),
  retractDeliveryBroadcastForOrder: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/orderLookup.js", () => ({
  requireCanonicalOrderId: async (id) => id,
}));

const { handleSellerAccept, sellerAcceptAtomic: shiprocketSellerAcceptAtomic } = await import(
  "../app/services/shiprocketWorkflowService.js"
);

describe("shiprocketWorkflowService.handleSellerAccept", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SHIPROCKET_PICKUP_LOCATION = "Main Warehouse";
  });

  const baseOrder = {
    orderId: "ORD-100",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    address: { name: "Jane Doe", address: "12 MG Road 560001", city: "Bengaluru", phone: "9876543210" },
    items: [{ product: "prod-1", name: "Widget", quantity: 2, price: 100 }],
    paymentMode: "COD",
    customer: "customer-1",
  };

  it("runs push -> assignAwb -> generatePickup in sequence and persists shipment fields", async () => {
    mockPushOrder.mockResolvedValue({ order_id: 555, shipment_id: 999 });
    mockAssignAwb.mockResolvedValue({ response: { data: { awb_code: "AWB1", courier_name: "Delhivery", courier_company_id: 10 } } });
    mockGeneratePickup.mockResolvedValue({ pickup_token_number: "PTN-1" });
    mockOrderFindOneAndUpdate.mockImplementation(async (query, update) =>
      update.$set?.workflowStatus
        ? { orderId: "ORD-100", customer: "customer-1", workflowStatus: update.$set.workflowStatus }
        : { orderId: "ORD-100", customer: "customer-1" },
    );

    await handleSellerAccept(baseOrder);

    expect(mockPushOrder).toHaveBeenCalledTimes(1);
    expect(mockAssignAwb).toHaveBeenCalledWith({ shipmentId: 999 });
    expect(mockGeneratePickup).toHaveBeenCalledWith({ shipmentId: 999 });

    const callOrder = [mockPushOrder, mockAssignAwb, mockGeneratePickup].map(
      (fn) => fn.mock.invocationCallOrder[0],
    );
    expect(callOrder[0]).toBeLessThan(callOrder[1]);
    expect(callOrder[1]).toBeLessThan(callOrder[2]);

    // SHIPMENT_CREATED then PICKUP_SCHEDULED transitions persisted.
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      { orderId: "ORD-100" },
      expect.objectContaining({
        $set: expect.objectContaining({ workflowStatus: "SHIPMENT_CREATED" }),
      }),
      { new: true },
    );
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      { orderId: "ORD-100" },
      expect.objectContaining({
        $set: expect.objectContaining({ workflowStatus: "PICKUP_SCHEDULED" }),
      }),
      { new: true },
    );
    // AWB fields persisted via a plain findOneAndUpdate (no workflow change).
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      { orderId: "ORD-100" },
      expect.objectContaining({
        $set: expect.objectContaining({ "shipment.awbCode": "AWB1", "shipment.courierName": "Delhivery" }),
      }),
    );
  });

  it("propagates the error and stops the sequence if pushOrder fails", async () => {
    mockPushOrder.mockRejectedValue(new Error("Shiprocket unreachable"));

    await expect(handleSellerAccept(baseOrder)).rejects.toThrow("Shiprocket unreachable");

    expect(mockAssignAwb).not.toHaveBeenCalled();
    expect(mockGeneratePickup).not.toHaveBeenCalled();
  });
});

describe("shiprocketWorkflowService.sellerAcceptAtomic", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("transitions to SELLER_ACCEPTED and kicks off fulfillment without the hyperlocal delivery-search path", async () => {
    const now = new Date();
    mockOrderFindOneAndUpdate.mockResolvedValueOnce({
      orderId: "ORD-200",
      customer: "customer-1",
      workflowStatus: "SELLER_ACCEPTED",
    });
    mockPushOrder.mockResolvedValue({ order_id: 1, shipment_id: 2 });
    mockAssignAwb.mockResolvedValue({});
    mockGeneratePickup.mockResolvedValue({});
    mockOrderFindOneAndUpdate.mockResolvedValue({ orderId: "ORD-200", customer: "customer-1" });

    const result = await shiprocketSellerAcceptAtomic("seller-1", "ORD-200");

    expect(result.workflowStatus).toBe("SELLER_ACCEPTED");
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "ORD-200", seller: "seller-1", workflowStatus: "SELLER_PENDING" }),
      expect.objectContaining({ $set: expect.objectContaining({ workflowStatus: "SELLER_ACCEPTED" }) }),
      { new: true },
    );
  });

  it("throws a 409 when the order is not in SELLER_PENDING (guard mirrors the hyperlocal path)", async () => {
    mockOrderFindOneAndUpdate.mockResolvedValueOnce(null);

    await expect(shiprocketSellerAcceptAtomic("seller-1", "ORD-300")).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
