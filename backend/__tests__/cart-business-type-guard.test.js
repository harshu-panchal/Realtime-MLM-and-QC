import { jest } from "@jest/globals";

/**
 * Verifies the cart-mixing guard added to cartController: a cart may only
 * hold items from one business type (Quick Commerce or E-commerce) at a
 * time. Adding a product from the other type returns a 409 conflict unless
 * `forceReplace: true` is sent, which clears the cart first. The cart's
 * `businessType` field resets to null once it becomes empty (remove/clear).
 */

const mockProductFindOne = jest.fn();
const mockSellerFindById = jest.fn();
const mockCartFindOne = jest.fn();
const mockCartFindById = jest.fn();
const mockCartSave = jest.fn().mockResolvedValue(true);

function makeCartDoc(overrides = {}) {
  return {
    customerId: "customer-1",
    items: [],
    businessType: null,
    save: mockCartSave,
    markModified: jest.fn(),
    ...overrides,
  };
}

const CartMock = jest.fn().mockImplementation((doc) => makeCartDoc(doc));
CartMock.findOne = mockCartFindOne;
CartMock.findById = mockCartFindById;

jest.unstable_mockModule("../app/models/cart.js", () => ({ default: CartMock }));

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: { findOne: mockProductFindOne },
}));

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: { findById: mockSellerFindById },
}));

jest.unstable_mockModule("../app/services/productModerationService.js", () => ({
  getApprovedOrLegacyFilter: jest.fn(() => ({})),
}));

const { addToCart, removeFromCart, clearCart } = await import(
  "../app/controller/cartController.js"
);

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

function mockProductLookup(sellerId) {
  mockProductFindOne.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue({ _id: "product-1", sellerId }),
  });
}

function mockSellerBusinessType(businessType) {
  mockSellerFindById.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(businessType ? { businessType } : null),
  });
}

function mockPopulatedCartFetch() {
  mockCartFindById.mockReturnValue({
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue({ items: [] }),
  });
}

describe("cartController business-type guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPopulatedCartFetch();
  });

  it("sets businessType on the first item added to an empty cart", async () => {
    mockProductLookup("seller-quick-1");
    mockSellerBusinessType("quick_commerce");
    const cart = makeCartDoc();
    mockCartFindOne.mockResolvedValue(cart);

    const req = {
      user: { id: "customer-1" },
      body: { productId: "product-1", quantity: 1 },
    };
    const res = buildResponse();

    await addToCart(req, res);

    expect(res.statusCode).toBe(200);
    expect(cart.businessType).toBe("quick_commerce");
    expect(cart.items).toHaveLength(1);
  });

  it("returns 409 when adding an item from a different business type without forceReplace", async () => {
    mockProductLookup("seller-ecom-1");
    mockSellerBusinessType("ecommerce");
    const cart = makeCartDoc({
      businessType: "quick_commerce",
      items: [{ productId: "existing-product", variantSku: "", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(cart);

    const req = {
      user: { id: "customer-1" },
      body: { productId: "product-1", quantity: 1 },
    };
    const res = buildResponse();

    await addToCart(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.result.conflict).toBe(true);
    expect(res.body.result.cartBusinessType).toBe("quick_commerce");
    expect(res.body.result.incomingBusinessType).toBe("ecommerce");
    // Cart is untouched on conflict.
    expect(cart.items).toHaveLength(1);
    expect(mockCartSave).not.toHaveBeenCalled();
  });

  it("clears the cart and adds the new item when forceReplace: true", async () => {
    mockProductLookup("seller-ecom-1");
    mockSellerBusinessType("ecommerce");
    const cart = makeCartDoc({
      businessType: "quick_commerce",
      items: [{ productId: "existing-product", variantSku: "", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(cart);

    const req = {
      user: { id: "customer-1" },
      body: { productId: "product-1", quantity: 1, forceReplace: true },
    };
    const res = buildResponse();

    await addToCart(req, res);

    expect(res.statusCode).toBe(200);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productId).toBe("product-1");
    expect(cart.businessType).toBe("ecommerce");
    expect(mockCartSave).toHaveBeenCalledTimes(1);
  });

  it("allows adding to an empty cart even if it previously had a different businessType stamped", async () => {
    // Cart was cleared down to 0 items but businessType hadn't been reset
    // (defensive case) — should not conflict since items.length === 0.
    mockProductLookup("seller-ecom-1");
    mockSellerBusinessType("ecommerce");
    const cart = makeCartDoc({ businessType: "quick_commerce", items: [] });
    mockCartFindOne.mockResolvedValue(cart);

    const req = {
      user: { id: "customer-1" },
      body: { productId: "product-1", quantity: 1 },
    };
    const res = buildResponse();

    await addToCart(req, res);

    expect(res.statusCode).toBe(200);
    expect(cart.businessType).toBe("ecommerce");
  });

  it("resets businessType to null once the last item is removed", async () => {
    const cart = makeCartDoc({
      businessType: "quick_commerce",
      items: [{ productId: { toString: () => "product-1" }, variantSku: "", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(cart);

    const req = {
      user: { id: "customer-1" },
      params: { productId: "product-1" },
      query: {},
    };
    const res = buildResponse();

    await removeFromCart(req, res);

    expect(res.statusCode).toBe(200);
    expect(cart.items).toHaveLength(0);
    expect(cart.businessType).toBeNull();
  });

  it("resets businessType to null on clearCart", async () => {
    const cart = makeCartDoc({
      businessType: "ecommerce",
      items: [{ productId: "product-1", variantSku: "", quantity: 1 }],
    });
    mockCartFindOne.mockResolvedValue(cart);

    const req = { user: { id: "customer-1" } };
    const res = buildResponse();

    await clearCart(req, res);

    expect(res.statusCode).toBe(200);
    expect(cart.items).toHaveLength(0);
    expect(cart.businessType).toBeNull();
  });
});
