import Seller from "../models/seller.js";
import { calculateDistance } from "../utils/helper.js";
import { buildKey, getOrSet, getTTL } from "./cacheService.js";

const MAX_SELLER_SEARCH_DISTANCE_M = 100000;

export function parseCustomerCoordinates(query = {}) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, lat: null, lng: null };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, lat: null, lng: null };
  }

  return { valid: true, lat, lng };
}

/**
 * Round lat/lng to 4 decimal places (~11m precision) for cache key.
 * This groups nearby requests into the same cache bucket.
 */
function buildNearbySellersKey(lat, lng) {
  const rLat = Number(lat).toFixed(4);
  const rLng = Number(lng).toFixed(4);
  return buildKey("sellers", "nearby", `${rLat}:${rLng}`);
}

// Quick Commerce is the only business type ever subject to radius/proximity
// gating, so this function hard-scopes to it — callers never need to
// remember to filter ecommerce sellers out of a "nearby" result.
export async function getNearbySellerIdsForCustomer(lat, lng) {
  const fetchFn = async () => {
    const sellers = await Seller.find({
      isActive: true,
      businessType: "quick_commerce",
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          $maxDistance: MAX_SELLER_SEARCH_DISTANCE_M,
        },
      },
    })
      .select("_id location serviceRadius")
      .lean();

    return sellers
      .filter((entity) => {
        const coords = entity?.location?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return false;
        const [entityLng, entityLat] = coords;
        if (!Number.isFinite(entityLat) || !Number.isFinite(entityLng)) {
          return false;
        }
        const distanceKm = calculateDistance(lat, lng, entityLat, entityLng);
        return distanceKm <= (entity.serviceRadius || 5);
      })
      .map((entity) => String(entity._id));
  };

  return getOrSet(buildNearbySellersKey(lat, lng), fetchFn, getTTL("nearbySellers"));
}

// ShopAll (E-commerce) counterpart: nationwide, no lat/lng, no radius math —
// every active ecommerce seller is visible to every customer everywhere.
export async function getEcommerceSellerIds() {
  const fetchFn = async () => {
    const sellers = await Seller.find({
      isActive: true,
      businessType: "ecommerce",
    })
      .select("_id")
      .lean();

    return sellers.map((entity) => String(entity._id));
  };

  return getOrSet(buildKey("sellers", "ecommerce", "all"), fetchFn, getTTL("nearbySellers"));
}

