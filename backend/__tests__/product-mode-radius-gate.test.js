import { jest } from "@jest/globals";

/**
 * Verifies the Quick vs ShopAll branching added to productController.getProducts:
 *  - mode=quick (default) keeps the existing radius-gated, lat/lng-required
 *    behavior for customers, now implicitly scoped to Quick Commerce sellers.
 *  - mode=shopAll requires no coordinates and scopes to E-commerce sellers
 *    via customerVisibilityService.getEcommerceSellerIds.
 *  - non-customer roles (seller/admin/delivery) are unaffected either way.
 */

const mockProductFind = jest.fn();
const mockProductCountDocuments = jest.fn();

function buildProductFindChain(items) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  };
  return chain;
}

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: {
    find: mockProductFind,
    countDocuments: mockProductCountDocuments,
  },
}));

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: { findOne: jest.fn() },
}));

jest.unstable_mockModule("../app/models/review.js", () => ({
  default: { findOne: jest.fn() },
}));

const mockGetNearbySellerIdsForCustomer = jest.fn();
const mockGetEcommerceSellerIds = jest.fn();

jest.unstable_mockModule("../app/services/customerVisibilityService.js", () => ({
  parseCustomerCoordinates: (query = {}) => {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { valid: false, lat: null, lng: null };
    }
    return { valid: true, lat, lng };
  },
  getNearbySellerIdsForCustomer: mockGetNearbySellerIdsForCustomer,
  getEcommerceSellerIds: mockGetEcommerceSellerIds,
}));

jest.unstable_mockModule("../app/services/searchSyncService.js", () => ({
  enqueueProductIndex: jest.fn(),
  enqueueProductRemoval: jest.fn(),
}));

jest.unstable_mockModule("../app/services/cacheService.js", () => ({
  buildKey: (...parts) => parts.join(":"),
  getOrSet: async (_key, fetchFn) => fetchFn(),
  getTTL: () => 1,
  invalidate: jest.fn(),
}));

jest.unstable_mockModule("../app/services/mediaService.js", () => ({
  uploadToCloudinary: jest.fn(),
}));

jest.unstable_mockModule("../app/services/entityNameCache.js", () => ({
  resolveCategoryName: jest.fn().mockResolvedValue(null),
  resolveSellerName: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule("../app/services/productModerationService.js", () => ({
  PRODUCT_APPROVAL_STATUS: { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" },
  getProductApprovalConfig: jest.fn(() => ({})),
  getApprovedOrLegacyFilter: jest.fn(() => ({})),
  buildApprovalStatusFilter: jest.fn(() => ({})),
  normalizeProductModerationFields: (product) => product,
  sanitizeApprovalNote: (note) => note,
  resolveProductApprovalStatus: () => "approved",
}));

const { getProducts } = await import("../app/controller/productController.js");

function buildRequest({ role, query }) {
  return {
    query,
    user: role ? { id: "user-1", role } : undefined,
  };
}

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

describe("productController getProducts commerce mode branching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProductFind.mockImplementation(() => buildProductFindChain([]));
    mockProductCountDocuments.mockResolvedValue(0);
    mockGetNearbySellerIdsForCustomer.mockResolvedValue(["quick-seller-1", "quick-seller-2"]);
    mockGetEcommerceSellerIds.mockResolvedValue(["ecom-seller-1", "ecom-seller-2"]);
  });

  it("mode=shopAll requires no coordinates and scopes to ecommerce sellers", async () => {
    const req = buildRequest({ role: "customer", query: { mode: "shopAll" } });
    const res = buildResponse();

    await getProducts(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockGetEcommerceSellerIds).toHaveBeenCalledTimes(1);
    expect(mockGetNearbySellerIdsForCustomer).not.toHaveBeenCalled();
    expect(mockProductFind).toHaveBeenCalledWith({
      $and: [
        {
          sellerId: { $in: ["ecom-seller-1", "ecom-seller-2"] },
          status: "active",
        },
        {},
      ],
    });
  });

  it("mode=quick (default) still requires lat/lng for customers", async () => {
    const req = buildRequest({ role: "customer", query: {} });
    const res = buildResponse();

    await getProducts(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockGetEcommerceSellerIds).not.toHaveBeenCalled();
    expect(mockGetNearbySellerIdsForCustomer).not.toHaveBeenCalled();
    expect(mockProductFind).not.toHaveBeenCalled();
  });

  it("mode=quick with lat/lng scopes to nearby (quick commerce) sellers", async () => {
    const req = buildRequest({
      role: "customer",
      query: { mode: "quick", lat: "12.9716", lng: "77.5946" },
    });
    const res = buildResponse();

    await getProducts(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockGetNearbySellerIdsForCustomer).toHaveBeenCalledWith(12.9716, 77.5946);
    expect(mockGetEcommerceSellerIds).not.toHaveBeenCalled();
    expect(mockProductFind).toHaveBeenCalledWith({
      $and: [
        {
          sellerId: { $in: ["quick-seller-1", "quick-seller-2"] },
          status: "active",
        },
        {},
      ],
    });
  });

  it("non-customer roles are unaffected by mode and skip business-type scoping entirely", async () => {
    const req = buildRequest({ role: "seller", query: { mode: "shopAll" } });
    const res = buildResponse();

    await getProducts(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockGetEcommerceSellerIds).not.toHaveBeenCalled();
    expect(mockGetNearbySellerIdsForCustomer).not.toHaveBeenCalled();
  });
});
