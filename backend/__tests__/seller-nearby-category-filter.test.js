import { jest } from "@jest/globals";

/**
 * Verifies sellerController.getNearbySellers is hard-scoped to Quick Commerce
 * sellers (an E-commerce seller within radius must never appear), and that
 * the new optional headerId/categoryId param further filters to sellers who
 * actually have an active product in that category.
 */

const mockSellerFind = jest.fn();
const mockProductDistinct = jest.fn();

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    find: mockSellerFind,
  },
}));

jest.unstable_mockModule("../app/models/transaction.js", () => ({
  default: {},
}));

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: {
    distinct: mockProductDistinct,
  },
}));

jest.unstable_mockModule("../app/services/entityNameCache.js", () => ({
  invalidateSellerName: jest.fn(),
}));

const { getNearbySellers } = await import("../app/controller/sellerController.js");

function buildResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

// Both sellers are within radius per the (mocked) $near query; distance math
// below places both at ~0km from the customer so serviceRadius always passes.
const QUICK_SELLER = {
  _id: "quick-seller-1",
  businessType: "quick_commerce",
  serviceRadius: 5,
  location: { type: "Point", coordinates: [77.5946, 12.9716] },
};

describe("sellerController getNearbySellers business-type + category scoping", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSellerFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([QUICK_SELLER]) });
  });

  it("only queries sellers with businessType: quick_commerce (never surfaces ecommerce sellers)", async () => {
    const req = { query: { lat: "12.9716", lng: "77.5946" } };
    const res = buildResponse();

    await getNearbySellers(req, res);

    expect(mockSellerFind).toHaveBeenCalledWith(
      expect.objectContaining({ businessType: "quick_commerce" }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]._id).toBe("quick-seller-1");
  });

  it("filters to sellers with an active product in the given headerId when provided", async () => {
    mockProductDistinct.mockResolvedValue(["quick-seller-1"]);
    const req = {
      query: { lat: "12.9716", lng: "77.5946", headerId: "header-groceries" },
    };
    const res = buildResponse();

    await getNearbySellers(req, res);

    expect(mockProductDistinct).toHaveBeenCalledWith(
      "sellerId",
      expect.objectContaining({
        sellerId: { $in: ["quick-seller-1"] },
        status: "active",
        $or: [{ headerId: "header-groceries" }, { categoryId: "header-groceries" }],
      }),
    );
    expect(res.body.results).toHaveLength(1);
  });

  it("excludes sellers that have no active product in the given headerId", async () => {
    mockProductDistinct.mockResolvedValue([]);
    const req = {
      query: { lat: "12.9716", lng: "77.5946", headerId: "header-electronics" },
    };
    const res = buildResponse();

    await getNearbySellers(req, res);

    expect(res.body.results).toHaveLength(0);
  });

  it("requires lat and lng", async () => {
    const req = { query: {} };
    const res = buildResponse();

    await getNearbySellers(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockSellerFind).not.toHaveBeenCalled();
  });
});
