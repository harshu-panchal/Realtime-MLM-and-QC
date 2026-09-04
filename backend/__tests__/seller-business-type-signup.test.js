import { jest } from "@jest/globals";

const mockSellerFindOne = jest.fn();
const mockSellerCreate = jest.fn();
const mockVerifySellerVerificationToken = jest.fn();
const mockUploadToCloudinary = jest.fn();

jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    findOne: mockSellerFindOne,
    create: mockSellerCreate,
  },
}));

jest.unstable_mockModule("../app/services/sellerVerificationService.js", () => ({
  issueSellerVerificationOtp: jest.fn(),
  verifySellerOtpCode: jest.fn(),
  verifySellerVerificationToken: mockVerifySellerVerificationToken,
  issueSellerResetOtp: jest.fn(),
  verifySellerResetOtpCode: jest.fn(),
}));

jest.unstable_mockModule("../app/services/mediaService.js", () => ({
  uploadToCloudinary: mockUploadToCloudinary,
}));

const { signupSeller } = await import("../app/controller/sellerAuthController.js");

function buildRequest(overrides = {}) {
  return {
    body: {
      name: "Seller Owner",
      email: "seller@example.com",
      phone: "9876543210",
      password: "secret123",
      emailVerificationToken: "email-token",
      phoneVerificationToken: "phone-token",
      shopName: "Noyo Mart",
      category: "Groceries",
      address: "MG Road",
      documents: JSON.stringify({
        tradeLicense: "https://example.com/trade-license.pdf",
        gstCertificate: "https://example.com/gst.pdf",
        idProof: "https://example.com/id-proof.pdf",
      }),
      ...overrides,
    },
    files: [],
    ip: "127.0.0.1",
  };
}

function buildResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe("sellerAuthController signupSeller businessType handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSellerFindOne.mockResolvedValue(null);
    mockSellerCreate.mockImplementation(async (payload) => ({
      _id: "seller-1",
      ...payload,
    }));
  });

  it("rejects signup when businessType is missing", async () => {
    const req = buildRequest({ businessType: undefined });
    const res = buildResponse();

    await signupSeller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSellerCreate).not.toHaveBeenCalled();
  });

  it("rejects signup when businessType is not a recognized value", async () => {
    const req = buildRequest({ businessType: "not_a_real_type" });
    const res = buildResponse();

    await signupSeller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSellerCreate).not.toHaveBeenCalled();
  });

  it("persists businessType: quick_commerce and still validates radius normally", async () => {
    const req = buildRequest({
      businessType: "quick_commerce",
      lat: "12.9716",
      lng: "77.5946",
      radius: "5",
    });
    const res = buildResponse();

    await signupSeller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockSellerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "quick_commerce",
        serviceRadius: 5,
      }),
    );
  });

  it("persists businessType: ecommerce while still collecting address/lat-lng", async () => {
    const req = buildRequest({
      businessType: "ecommerce",
      lat: "12.9716",
      lng: "77.5946",
      radius: "5",
    });
    const res = buildResponse();

    await signupSeller(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockSellerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "ecommerce",
        location: {
          type: "Point",
          coordinates: [77.5946, 12.9716],
        },
      }),
    );
  });

  it("still rejects an out-of-range radius identically for both business types", async () => {
    const req = buildRequest({ businessType: "ecommerce", radius: "500" });
    const res = buildResponse();

    await signupSeller(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSellerCreate).not.toHaveBeenCalled();
  });
});
