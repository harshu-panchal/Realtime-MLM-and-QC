import Seller from "../../models/seller.js";
import {
  escapeRegExp,
  formatSellerApplication,
  formatSellerDocuments,
} from "./shared/sellerAdminUtils.js";

export async function getPendingSellerApplications({
  q = "",
  status = "pending",
  page,
  limit,
  skip,
}) {
  const normalizedStatus = String(status || "pending").trim().toLowerCase();
  let baseStatusQuery = { isVerified: { $ne: true } };

  if (normalizedStatus === "pending") {
    baseStatusQuery = {
      isVerified: { $ne: true },
      $or: [
        { applicationStatus: "pending" },
        { applicationStatus: { $exists: false } },
        { applicationStatus: null },
      ],
    };
  } else if (normalizedStatus !== "all") {
    baseStatusQuery = {
      isVerified: { $ne: true },
      applicationStatus: normalizedStatus,
    };
  }

  const conditions = [baseStatusQuery];
  const search = String(q || "").trim();
  if (search) {
    const regex = new RegExp(escapeRegExp(search), "i");
    conditions.push({
      $or: [
        { name: regex },
        { shopName: regex },
        { email: regex },
        { phone: regex },
        { address: regex },
      ],
    });
  }

  const query = conditions.length > 1 ? { $and: conditions } : conditions[0];

  const [sellers, total, allPendingForStats] = await Promise.all([
    Seller.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Seller.countDocuments(query),
    Seller.find({
      isVerified: { $ne: true },
      $or: [
        { applicationStatus: "pending" },
        { applicationStatus: { $exists: false } },
      ],
    })
      .select("address documents createdAt")
      .lean(),
  ]);

  const items = sellers.map(formatSellerApplication);
  const totalApplications = allPendingForStats.length;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const receivedToday = allPendingForStats.filter(
    (seller) => seller.createdAt && new Date(seller.createdAt) >= todayStart,
  ).length;

  const missingInfo = allPendingForStats.filter((seller) => {
    const docs = formatSellerDocuments(seller.documents);
    return !seller.address || docs.length < 3;
  }).length;

  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    stats: {
      totalApplications,
      receivedToday,
      missingInfo,
      avgReviewTimeHours: 24,
    },
  };
}

export async function approveSellerApplicationById({
  sellerId,
  reviewedBy,
  commissionValue,
}) {
  const existing = await Seller.findById(sellerId).select("commissionValue");
  if (!existing) {
    return null;
  }

  const hasIncomingCommission =
    commissionValue !== undefined && commissionValue !== null && commissionValue !== "";
  const parsedCommission = hasIncomingCommission ? Number(commissionValue) : null;

  if (hasIncomingCommission && (!Number.isFinite(parsedCommission) || parsedCommission < 0 || parsedCommission > 100)) {
    const error = new Error("Commission rate must be a number between 0 and 100");
    error.statusCode = 400;
    throw error;
  }

  if (!hasIncomingCommission && existing.commissionValue == null) {
    const error = new Error("Commission rate is required before approval");
    error.statusCode = 400;
    throw error;
  }

  const commissionSet = hasIncomingCommission
    ? {
        commissionType: "percentage",
        commissionValue: parsedCommission,
        commissionFixedRule: null,
        commissionSetAt: new Date(),
        commissionSetBy: reviewedBy,
      }
    : {};

  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    {
      $set: {
        isVerified: true,
        isActive: true,
        applicationStatus: "approved",
        reviewedAt: new Date(),
        reviewedBy,
        rejectionReason: null,
        ...commissionSet,
      },
    },
    { new: true },
  );

  if (!seller) {
    return null;
  }

  return formatSellerApplication(seller);
}

export async function setSellerCommission({ sellerId, commissionValue, adminId }) {
  const parsedCommission = Number(commissionValue);
  if (!Number.isFinite(parsedCommission) || parsedCommission < 0 || parsedCommission > 100) {
    const error = new Error("Commission rate must be a number between 0 and 100");
    error.statusCode = 400;
    throw error;
  }

  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    {
      $set: {
        commissionType: "percentage",
        commissionValue: parsedCommission,
        commissionFixedRule: null,
        commissionSetAt: new Date(),
        commissionSetBy: adminId,
      },
    },
    { new: true },
  );

  if (!seller) {
    return null;
  }

  return formatSellerApplication(seller);
}

export async function rejectSellerApplicationById({
  sellerId,
  reviewedBy,
  reason,
}) {
  const seller = await Seller.findByIdAndUpdate(
    sellerId,
    {
      $set: {
        isVerified: false,
        isActive: false,
        applicationStatus: "rejected",
        reviewedAt: new Date(),
        reviewedBy,
        rejectionReason: reason || "",
      },
    },
    { new: true },
  );

  if (!seller) {
    return null;
  }

  return formatSellerApplication(seller);
}
