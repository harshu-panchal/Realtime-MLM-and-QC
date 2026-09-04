import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Store } from "lucide-react";
import { customerApi } from "../../services/customerApi";
import { useLocation as useAppLocation } from "../../context/LocationContext";

// Quick tab: switching header categories shows the nearby-sellers list for
// that category inline, right below the hero banner — no navigation away
// from Home. Clicking a seller still opens its storefront page.
const QuickCategorySellersSection = ({ categoryId, categoryName }) => {
  const navigate = useNavigate();
  const { currentLocation } = useAppLocation();
  const [sellers, setSellers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const hasValidLocation =
      Number.isFinite(currentLocation?.latitude) &&
      Number.isFinite(currentLocation?.longitude);

    if (!categoryId || !hasValidLocation) {
      setSellers([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    customerApi
      .getNearbySellers({
        lat: currentLocation.latitude,
        lng: currentLocation.longitude,
        headerId: categoryId,
      })
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.results || res.data?.result || [];
        setSellers(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSellers([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryId, currentLocation?.latitude, currentLocation?.longitude]);

  const handleSellerClick = (seller) => {
    navigate(`/quick/seller/${seller._id}`, { state: { categoryId, categoryName } });
  };

  if (isLoading) {
    return (
      <div className="px-4 pt-3 space-y-2.5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (sellers.length === 0) {
    return (
      <div className="px-4 pt-4 pb-2 text-center">
        <p className="text-xs font-bold text-slate-400">
          No sellers deliver {categoryName ? `"${categoryName}"` : "this category"} to your location yet.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-3 space-y-2.5">
      <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest px-1">
        {categoryName ? `${categoryName} sellers near you` : "Sellers near you"}
      </h3>
      {sellers.map((seller) => (
        <button
          key={seller._id}
          onClick={() => handleSellerClick(seller)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md active:scale-[0.99] transition-all text-left"
        >
          <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
            <Store className="text-gray-400" size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-sm truncate">{seller.shopName}</p>
            <p className="text-[11px] text-gray-500 truncate flex items-center gap-1 mt-0.5">
              <MapPin size={11} className="shrink-0" />
              {seller.address || seller.locality || "Nearby"}
            </p>
          </div>
          {Number.isFinite(seller.distance) && (
            <span className="text-[11px] font-black text-primary shrink-0">
              {seller.distance.toFixed(1)} km
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export default QuickCategorySellersSection;
