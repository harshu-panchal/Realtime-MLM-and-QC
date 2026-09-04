import { jest } from "@jest/globals";

/**
 * Verifies sellerController.getSellerStorefront: the new public endpoint
 * backing the Quick-tab seller storefront page. Returns seller identity plus
 * the distinct categories that seller has active/approved products under.
 */

const mockSellerFindOne = jest.fn();
const mockProductDistinct = jest.fn();
const mockCategoryFind = jest.fn();

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: { findOne: mockSellerFindOne },
}));

jest.unstable_mockModule("../app/models/transaction.js", () => ({
  default: {},
}));

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: { distinct: mockProductDistinct },
}));

jest.unstable_mockModule("../app/models/category.js", () => ({
  default: { find: mockCategoryFind },
}));

jest.unstable_mockModule("../app/services/entityNameCache.js", () => ({
  invalidateSellerName: jest.fn(),
}));

jest.unstable_mockModule("../app/services/productModerationService.js", () => ({
  getApprovedOrLegacyFilter: jest.fn(() => ({})),
}));

const { getSellerStorefront } = await import("../app/controller/sellerController.js");

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

const VALID_SELLER_ID = "507f1f77bcf86cd799439011";

describe("sellerController getSellerStorefront", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects an invalid seller id", async () => {
    const req = { params: { sellerId: "not-an-id" } };
    const res = buildResponse();

    await getSellerStorefront(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockSellerFindOne).not.toHaveBeenCalled();
  });

  it("404s when the seller doesn't exist or isn't active/verified", async () => {
    mockSellerFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    const req = { params: { sellerId: VALID_SELLER_ID } };
    const res = buildResponse();

    await getSellerStorefront(req, res);

    expect(res.statusCode).toBe(404);
  });

  it("returns seller identity and its distinct active-product categories", async () => {
    mockSellerFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: VALID_SELLER_ID,
        shopName: "Fresh Mart",
        address: "12 Market Road",
      }),
    });
    mockProductDistinct.mockResolvedValue(["cat-1", "cat-2"]);
    mockCategoryFind.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { _id: "cat-1", name: "Vegetables" },
        { _id: "cat-2", name: "Dairy" },
      ]),
    });

    const req = { params: { sellerId: VALID_SELLER_ID } };
    const res = buildResponse();

    await getSellerStorefront(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockProductDistinct).toHaveBeenCalledWith(
      "categoryId",
      expect.objectContaining({
        $and: [{ sellerId: VALID_SELLER_ID, status: "active" }, {}],
      }),
    );
    expect(res.body.result.seller.shopName).toBe("Fresh Mart");
    expect(res.body.result.categories).toHaveLength(2);
  });

  it("returns an empty category list when the seller has no active products", async () => {
    mockSellerFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        _id: VALID_SELLER_ID,
        shopName: "Empty Shop",
        address: "1 Nowhere Lane",
      }),
    });
    mockProductDistinct.mockResolvedValue([]);

    const req = { params: { sellerId: VALID_SELLER_ID } };
    const res = buildResponse();

    await getSellerStorefront(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockCategoryFind).not.toHaveBeenCalled();
    expect(res.body.result.categories).toHaveLength(0);
  });
});
