import Seller from "../models/seller.js";
import Transaction from "../models/transaction.js";
import Product from "../models/product.js";
import Category from "../models/category.js";
import { handleResponse, calculateDistance } from "../utils/helper.js";
import mongoose from "mongoose";
import { invalidateSellerName } from "../services/entityNameCache.js";
import { getApprovedOrLegacyFilter } from "../services/productModerationService.js";

/* ===============================
   GET NEARBY SELLERS
================================ */
// This is the Quick tab's dedicated lookup — permanently scoped to
// Quick Commerce sellers, since E-commerce sellers are never subject to
// radius/proximity gating (see customerVisibilityService.getEcommerceSellerIds
// for the ShopAll counterpart).
export const getNearbySellers = async (req, res) => {
  try {
    const { lat, lng, headerId, categoryId } = req.query;

    if (!lat || !lng) {
      return handleResponse(res, 400, "Latitude and longitude are required");
    }

    const customerLat = Number(lat);
    const customerLng = Number(lng);

    // Fetch all active/verified quick commerce sellers
    const sellers = await Seller.find({
      isActive: true,
      isVerified: true,
      businessType: "quick_commerce",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [customerLng, customerLat],
          },
          $maxDistance: 100000, // 100km max search area
        },
      },
    })
      .select(
        "shopName address locality city pincode state location serviceRadius isActive isVerified businessType bannerImage logo rating deliveryTime offerTitle offerSubtitle"
      )
      .lean();

    // Filter based on individual service radius
    let nearbySellers = sellers.filter((seller) => {
      const sellerLng = seller.location?.coordinates?.[0];
      const sellerLat = seller.location?.coordinates?.[1];
      if (sellerLat === undefined || sellerLng === undefined) return false;

      const distance = calculateDistance(
        customerLat,
        customerLng,
        sellerLat,
        sellerLng
      );

      seller.distance = distance;
      return distance <= (seller.serviceRadius || 5);
    });

    // Scope to sellers having active products in category if category filter is present
    const categoryFilter = headerId || categoryId;
    if (categoryFilter && nearbySellers.length > 0) {
      const matchingSellerIds = await Product.distinct("sellerId", {
        sellerId: { $in: nearbySellers.map((s) => s._id) },
        status: "active",
        $or: [{ headerId: categoryFilter }, { categoryId: categoryFilter }],
      });
      const matchingSet = new Set(matchingSellerIds.map(String));
      nearbySellers = nearbySellers.filter((seller) => matchingSet.has(String(seller._id)));
    }

    // Parallel fast fetch top 4 active products per seller (indexed + limited per seller)
    if (nearbySellers.length > 0) {
      await Promise.all(
        nearbySellers.map(async (seller) => {
          const prods = await Product.find({
            sellerId: seller._id,
            status: "active",
          })
            .select("name mainImage image images price salePrice discountPrice")
            .limit(4)
            .lean();

          seller.topProducts = prods.map((prod) => ({
            _id: prod._id,
            name: prod.name,
            image: prod.mainImage || prod.image || (prod.images && prod.images[0]) || "",
            price: prod.salePrice || prod.discountPrice || prod.price || 0,
            originalPrice: prod.price || 0,
          }));
        })
      );
    }

    return handleResponse(
      res,
      200,
      "Nearby sellers fetched successfully",
      nearbySellers
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET SELLER STOREFRONT (public, Quick tab)
================================ */
// Powers the seller storefront page: seller identity + the list of
// categories this seller actually has active products under (rendered as
// tabs). Product data per tab is fetched separately via the existing
// getProducts endpoint (sellerId + categoryId + mode=quick) to avoid a
// second products-listing implementation.
export const getSellerStorefront = async (req, res) => {
  try {
    const { sellerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return handleResponse(res, 400, "Invalid seller id");
    }

    const seller = await Seller.findOne({
      _id: sellerId,
      isActive: true,
      isVerified: true,
    })
      .select(
        "shopName address businessType bannerImage logo rating locality city serviceRadius category description deliveryTime offerTitle offerSubtitle"
      )
      .lean();

    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }

    const categoryIds = await Product.distinct("categoryId", {
      $and: [{ sellerId, status: "active" }, getApprovedOrLegacyFilter()],
    });

    const categories = categoryIds.length
      ? await Category.find({ _id: { $in: categoryIds } })
          .select("name image sortOrder")
          .sort({ sortOrder: 1, name: 1 })
          .lean()
      : [];

    return handleResponse(res, 200, "Seller storefront fetched successfully", {
      seller,
      categories,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   REQUEST WITHDRAWAL (Seller)
================================ */
export const requestWithdrawal = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return handleResponse(res, 400, "Please enter a valid amount");
    }

    // 1. Calculate current available balance
    // Consistent with getSellerEarnings logic in sellerStatsController.js
    const transactions = await Transaction.find({
      user: sellerId,
      userModel: "Seller",
    })
      .select("status amount type")
      .lean();

    const settledBalance = transactions
      .filter((t) => t.status === "Settled")
      .reduce((acc, t) => acc + (t.amount || 0), 0);

    const pendingPayouts = transactions
      .filter(
        (t) =>
          t.type === "Withdrawal" &&
          (t.status === "Pending" || t.status === "Processing"),
      )
      .reduce((acc, t) => acc + Math.abs(t.amount || 0), 0);

    const availableBalance = settledBalance - pendingPayouts;

    if (amount > availableBalance) {
      return handleResponse(
        res,
        400,
        `Insufficient balance. Available: ₹${availableBalance}`,
      );
    }

    // 2. Create Withdrawal Transaction
    // Withdrawals have negative amounts per the model comment
    const withdrawal = await Transaction.create({
      user: sellerId,
      userModel: "Seller",
      type: "Withdrawal",
      amount: -Math.abs(amount),
      status: "Pending",
      reference: `WDR-${Date.now()}`,
    });

    return handleResponse(
      res,
      201,
      "Withdrawal request submitted successfully",
      withdrawal,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET SELLER PROFILE
================================ */
export const getSellerProfile = async (req, res) => {
  try {
    const seller = await Seller.findById(req.user.id);
    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }
    return handleResponse(
      res,
      200,
      "Seller profile fetched successfully",
      seller,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   UPDATE SELLER PROFILE
================================ */
export const updateSellerProfile = async (req, res) => {
  try {
    const {
      name,
      shopName,
      phone,
      address,
      locality,
      pincode,
      city,
      state,
      lat,
      lng,
      radius,
      bannerImage,
      logo,
      deliveryTime,
      offerTitle,
      offerSubtitle,
      category,
      description,
      rating,
    } = req.body;

    // Find seller
    const seller = await Seller.findById(req.user.id);
    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }

    // Update fields if provided
    if (name) seller.name = name;
    if (shopName) seller.shopName = shopName;
    if (phone) seller.phone = phone;
    if (address !== undefined) seller.address = address;
    if (locality !== undefined) seller.locality = locality;
    if (pincode !== undefined) seller.pincode = pincode;
    if (city !== undefined) seller.city = city;
    if (state !== undefined) seller.state = state;
    if (bannerImage !== undefined) seller.bannerImage = bannerImage;
    if (logo !== undefined) seller.logo = logo;
    if (deliveryTime !== undefined) seller.deliveryTime = deliveryTime;
    if (offerTitle !== undefined) seller.offerTitle = offerTitle;
    if (offerSubtitle !== undefined) seller.offerSubtitle = offerSubtitle;
    if (category !== undefined) seller.category = category;
    if (description !== undefined) seller.description = description;
    if (rating !== undefined) seller.rating = Number(rating);

    // Validate and update geo data
    if (lat !== undefined && lng !== undefined) {
      if (lat < -90 || lat > 90)
        return handleResponse(res, 400, "Invalid latitude");
      if (lng < -180 || lng > 180)
        return handleResponse(res, 400, "Invalid longitude");

      seller.location = {
        type: "Point",
        coordinates: [Number(lng), Number(lat)],
      };
    }

    if (radius !== undefined) {
      if (radius < 1 || radius > 100)
        return handleResponse(res, 400, "Radius must be between 1 and 100 km");
      seller.serviceRadius = Number(radius);
    }

    const updatedSeller = await seller.save();

    // Invalidate cached seller name in case shopName changed
    invalidateSellerName(req.user.id).catch((err) => {
      console.warn("[Seller] Name cache invalidation failed:", err.message);
    });

    return handleResponse(
      res,
      200,
      "Profile updated successfully",
      updatedSeller,
    );
  } catch (error) {
    // Handle duplicate phone error
    if (error.code === 11000) {
      return handleResponse(res, 400, "Phone number already in use");
    }
    return handleResponse(res, 500, error.message);
  }
};
