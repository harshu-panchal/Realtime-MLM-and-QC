import Seller from "../../models/seller.js";
import { formatSellerApplication } from "./shared/sellerAdminUtils.js";

const VALID_BUSINESS_TYPES = ["quick_commerce", "ecommerce"];

export async function submitBusinessTypeChangeRequest({ sellerId, requestedType, reason }) {
  if (!VALID_BUSINESS_TYPES.includes(requestedType)) {
    const error = new Error("requestedType must be either 'quick_commerce' or 'ecommerce'");
    error.statusCode = 400;
    throw error;
  }

  const seller = await Seller.findById(sellerId);
  if (!seller) {
    return null;
  }

  if (seller.businessType === requestedType) {
    const error = new Error("Seller is already registered under this business type");
    error.statusCode = 400;
    throw error;
  }

  if (seller.businessTypeChangeRequest?.status === "pending") {
    const error = new Error("A business type change request is already pending");
    error.statusCode = 409;
    throw error;
  }

  seller.businessTypeChangeRequest = {
    requestedType,
    reason: reason || "",
    status: "pending",
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    adminNote: "",
  };

  await seller.save();
  return formatSellerApplication(seller);
}

export async function getPendingBusinessTypeChangeRequests({ page, limit, skip }) {
  const query = { "businessTypeChangeRequest.status": "pending" };

  const [sellers, total] = await Promise.all([
    Seller.find(query)
      .sort({ "businessTypeChangeRequest.requestedAt": -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Seller.countDocuments(query),
  ]);

  return {
    items: sellers.map(formatSellerApplication),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function approveBusinessTypeChangeRequestById({ sellerId, reviewedBy, adminNote }) {
  const seller = await Seller.findById(sellerId);
  if (!seller || seller.businessTypeChangeRequest?.status !== "pending") {
    return null;
  }

  seller.businessType = seller.businessTypeChangeRequest.requestedType;
  seller.businessTypeChangeRequest.status = "approved";
  seller.businessTypeChangeRequest.reviewedAt = new Date();
  seller.businessTypeChangeRequest.reviewedBy = reviewedBy;
  seller.businessTypeChangeRequest.adminNote = adminNote || "";

  await seller.save();
  return formatSellerApplication(seller);
}

export async function rejectBusinessTypeChangeRequestById({ sellerId, reviewedBy, adminNote }) {
  const seller = await Seller.findById(sellerId);
  if (!seller || seller.businessTypeChangeRequest?.status !== "pending") {
    return null;
  }

  seller.businessTypeChangeRequest.status = "rejected";
  seller.businessTypeChangeRequest.reviewedAt = new Date();
  seller.businessTypeChangeRequest.reviewedBy = reviewedBy;
  seller.businessTypeChangeRequest.adminNote = adminNote || "";

  await seller.save();
  return formatSellerApplication(seller);
}
