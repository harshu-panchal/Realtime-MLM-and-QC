import { jest } from "@jest/globals";

/**
 * Regression guard: orderWorkflowService.sellerAcceptAtomic must branch
 * ecommerce orders to shiprocketWorkflowService and leave the hyperlocal
 * DeliveryAssignment/rider-broadcast path completely untouched for them —
 * and, symmetrically, quick_commerce orders must never call into
 * shiprocketWorkflowService.
 */

const mockOrderFindOne = jest.fn();
const mockOrderFindOneAndUpdate = jest.fn();
const mockDeliveryAssignmentCreate = jest.fn().mockResolvedValue({});
const mockEmitOrderStatusUpdate = jest.fn();
const mockEmitDeliveryBroadcastForSeller = jest.fn().mockResolvedValue();
const mockShiprocketSellerAcceptAtomic = jest.fn().mockResolvedValue({ workflowStatus: "SELLER_ACCEPTED" });
const mockRemoveSellerTimeout = jest.fn();
const mockScheduleDeliveryTimeout = jest.fn();
const mockEmitNotificationEvent = jest.fn();

function makeThenableQuery(result) {
  const query = {
    populate: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    findOne: mockOrderFindOne,
    findOneAndUpdate: mockOrderFindOneAndUpdate,
  },
}));

jest.unstable_mockModule("../app/models/deliveryAssignment.js", () => ({
  default: { create: mockDeliveryAssignmentCreate },
}));

jest.unstable_mockModule("../app/models/orderOtp.js", () => ({ default: {} }));
jest.unstable_mockModule("../app/models/seller.js", () => ({ default: {} }));
jest.unstable_mockModule("../app/models/delivery.js", () => ({ default: {} }));

jest.unstable_mockModule("../app/services/firebaseService.js", () => ({
  clearOrderTracking: jest.fn(),
  clearRiderPresence: jest.fn(),
}));

jest.unstable_mockModule("../app/services/orderCompensation.js", () => ({
  compensateOrderCancellation: jest.fn(),
}));

jest.unstable_mockModule("../app/config/redis.js", () => ({
  getRedisClient: jest.fn(),
}));

jest.unstable_mockModule("../app/services/workflow/jobSchedulerPort.js", () => ({
  scheduleSellerTimeout: jest.fn(),
  removeSellerTimeout: mockRemoveSellerTimeout,
  scheduleDeliveryTimeout: mockScheduleDeliveryTimeout,
  removeDeliveryTimeout: jest.fn(),
  scheduleReturnPickupTimeout: jest.fn(),
  removeReturnPickupTimeout: jest.fn(),
}));

jest.unstable_mockModule("../app/services/orderSocketEmitter.js", () => ({
  emitOrderStatusUpdate: mockEmitOrderStatusUpdate,
  emitToSeller: jest.fn(),
  emitDeliveryBroadcastForSeller: mockEmitDeliveryBroadcastForSeller,
  emitReturnBroadcastForCustomer: jest.fn(),
  emitToCustomer: jest.fn(),
  emitToOrder: jest.fn(),
  retractDeliveryBroadcastForOrder: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/geoUtils.js", () => ({
  distanceMeters: jest.fn(),
}));

jest.unstable_mockModule("../app/services/orderSettlement.js", () => ({
  applyDeliveredSettlement: jest.fn(),
}));

jest.unstable_mockModule("../app/utils/orderLookup.js", () => ({
  requireCanonicalOrderId: async (id) => id,
}));

jest.unstable_mockModule("../app/modules/notifications/notification.emitter.js", () => ({
  emitNotificationEvent: mockEmitNotificationEvent,
}));

jest.unstable_mockModule("../app/modules/notifications/notification.constants.js", () => ({
  NOTIFICATION_EVENTS: { ORDER_CONFIRMED: "ORDER_CONFIRMED" },
}));

jest.unstable_mockModule("../app/services/logger.js", () => ({
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule("../app/services/shiprocketWorkflowService.js", () => ({
  sellerAcceptAtomic: mockShiprocketSellerAcceptAtomic,
}));

const { sellerAcceptAtomic } = await import("../app/services/orderWorkflowService.js");

describe("orderWorkflowService.sellerAcceptAtomic ecommerce/quick_commerce branch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeliveryAssignmentCreate.mockResolvedValue({});
    mockEmitDeliveryBroadcastForSeller.mockResolvedValue();
  });

  it("branches ecommerce orders to shiprocketWorkflowService and never touches DeliveryAssignment/rider broadcast", async () => {
    mockOrderFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ businessType: "ecommerce" }),
    });

    const result = await sellerAcceptAtomic("seller-1", "ORD-ECOM-1");

    expect(mockShiprocketSellerAcceptAtomic).toHaveBeenCalledWith("seller-1", "ORD-ECOM-1");
    expect(result).toEqual({ workflowStatus: "SELLER_ACCEPTED" });
    expect(mockOrderFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockDeliveryAssignmentCreate).not.toHaveBeenCalled();
    expect(mockEmitDeliveryBroadcastForSeller).not.toHaveBeenCalled();
  });

  it("runs the existing hyperlocal DELIVERY_SEARCH path unchanged for quick_commerce orders, without calling shiprocketWorkflowService", async () => {
    mockOrderFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ businessType: "quick_commerce" }),
    });
    const updatedOrder = {
      _id: "order-doc-1",
      orderId: "ORD-QC-1",
      customer: { _id: "customer-1" },
      seller: { _id: "seller-1", shopName: "Shop" },
      deliverySearchExpiresAt: new Date(),
    };
    mockOrderFindOneAndUpdate.mockReturnValue(makeThenableQuery(updatedOrder));

    const result = await sellerAcceptAtomic("seller-1", "ORD-QC-1");

    expect(mockShiprocketSellerAcceptAtomic).not.toHaveBeenCalled();
    expect(mockOrderFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "ORD-QC-1", workflowStatus: "SELLER_PENDING" }),
      expect.objectContaining({
        $set: expect.objectContaining({ workflowStatus: "DELIVERY_SEARCH" }),
      }),
      { new: true },
    );
    expect(mockDeliveryAssignmentCreate).toHaveBeenCalledTimes(1);
    expect(mockEmitDeliveryBroadcastForSeller).toHaveBeenCalledTimes(1);
    expect(result).toBe(updatedOrder);
  });
});
