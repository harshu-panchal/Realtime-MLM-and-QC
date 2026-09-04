import { jest } from "@jest/globals";

/**
 * Verifies the seller-initiated, admin-approved business type change flow
 * (sellerBusinessTypeService.js): a seller can request to switch between
 * Quick Commerce and E-commerce, but the switch only takes effect once an
 * admin approves it.
 */

const mockSellerFindById = jest.fn();
const mockSave = jest.fn().mockResolvedValue(true);

function makeSellerDoc(overrides = {}) {
  return {
    _id: "seller-1",
    businessType: "quick_commerce",
    businessTypeChangeRequest: { status: "none" },
    save: mockSave,
    ...overrides,
  };
}

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: { findById: mockSellerFindById },
}));

const {
  submitBusinessTypeChangeRequest,
  approveBusinessTypeChangeRequestById,
  rejectBusinessTypeChangeRequestById,
} = await import("../app/services/admin/sellerBusinessTypeService.js");

describe("sellerBusinessTypeService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("submitBusinessTypeChangeRequest", () => {
    it("rejects an invalid requestedType", async () => {
      await expect(
        submitBusinessTypeChangeRequest({
          sellerId: "seller-1",
          requestedType: "not_real",
        }),
      ).rejects.toThrow(/quick_commerce.*ecommerce/);
      expect(mockSellerFindById).not.toHaveBeenCalled();
    });

    it("returns null when the seller doesn't exist", async () => {
      mockSellerFindById.mockResolvedValue(null);
      const result = await submitBusinessTypeChangeRequest({
        sellerId: "missing",
        requestedType: "ecommerce",
      });
      expect(result).toBeNull();
    });

    it("rejects requesting the seller's current business type", async () => {
      mockSellerFindById.mockResolvedValue(makeSellerDoc({ businessType: "ecommerce" }));
      await expect(
        submitBusinessTypeChangeRequest({
          sellerId: "seller-1",
          requestedType: "ecommerce",
        }),
      ).rejects.toThrow(/already registered/);
    });

    it("rejects a second request while one is already pending", async () => {
      mockSellerFindById.mockResolvedValue(
        makeSellerDoc({ businessTypeChangeRequest: { status: "pending" } }),
      );
      await expect(
        submitBusinessTypeChangeRequest({
          sellerId: "seller-1",
          requestedType: "ecommerce",
        }),
      ).rejects.toThrow(/already pending/);
    });

    it("stores a pending request with the requested type and reason", async () => {
      const seller = makeSellerDoc();
      mockSellerFindById.mockResolvedValue(seller);

      await submitBusinessTypeChangeRequest({
        sellerId: "seller-1",
        requestedType: "ecommerce",
        reason: "Expanding nationwide",
      });

      expect(seller.businessTypeChangeRequest.status).toBe("pending");
      expect(seller.businessTypeChangeRequest.requestedType).toBe("ecommerce");
      expect(seller.businessTypeChangeRequest.reason).toBe("Expanding nationwide");
      expect(seller.businessType).toBe("quick_commerce"); // unchanged until approved
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("approveBusinessTypeChangeRequestById", () => {
    it("returns null when there is no pending request", async () => {
      mockSellerFindById.mockResolvedValue(makeSellerDoc());
      const result = await approveBusinessTypeChangeRequestById({
        sellerId: "seller-1",
        reviewedBy: "admin-1",
      });
      expect(result).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("applies the requested businessType and marks the request approved", async () => {
      const seller = makeSellerDoc({
        businessTypeChangeRequest: { status: "pending", requestedType: "ecommerce" },
      });
      mockSellerFindById.mockResolvedValue(seller);

      await approveBusinessTypeChangeRequestById({ sellerId: "seller-1", reviewedBy: "admin-1" });

      expect(seller.businessType).toBe("ecommerce");
      expect(seller.businessTypeChangeRequest.status).toBe("approved");
      expect(seller.businessTypeChangeRequest.reviewedBy).toBe("admin-1");
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("rejectBusinessTypeChangeRequestById", () => {
    it("marks the request rejected without changing businessType", async () => {
      const seller = makeSellerDoc({
        businessTypeChangeRequest: { status: "pending", requestedType: "ecommerce" },
      });
      mockSellerFindById.mockResolvedValue(seller);

      await rejectBusinessTypeChangeRequestById({ sellerId: "seller-1", reviewedBy: "admin-1" });

      expect(seller.businessType).toBe("quick_commerce");
      expect(seller.businessTypeChangeRequest.status).toBe("rejected");
      expect(mockSave).toHaveBeenCalledTimes(1);
    });
  });
});
