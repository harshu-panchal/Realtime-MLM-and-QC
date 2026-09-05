import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Store, Star, Clock, Sparkles, ChevronRight, Flame } from "lucide-react";
import { customerApi } from "../../services/customerApi";
import { useLocation as useAppLocation } from "../../context/LocationContext";

// Fallback banner backgrounds for rich visual variety if no custom banner exists
const FALLBACK_BANNERS = [
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80", // Supermarket / Grocery
  "https://images.unsplash.com/photo-1506617420156-8e4536971650?auto=format&fit=crop&w=800&q=80", // Organic produce
  "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=800&q=80", // Mart / Retail
  "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=800&q=80", // Express store
];

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

    if (!hasValidLocation) {
      setSellers([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    const params = {
      lat: currentLocation.latitude,
      lng: currentLocation.longitude,
    };
    if (categoryId && categoryId !== "all") {
      params.headerId = categoryId;
    }

    customerApi
      .getNearbySellers(params)
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
      <div className="px-4 pt-3 space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-56 rounded-3xl bg-slate-100 animate-pulse border border-slate-200/60" />
        ))}
      </div>
    );
  }

  if (sellers.length === 0) {
    return (
      <div className="px-4 pt-6 pb-4 text-center">
        <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
          <Store size={28} />
        </div>
        <p className="text-sm font-bold text-slate-700">No stores available nearby</p>
        <p className="text-xs text-slate-400 mt-1">
          No quick commerce sellers deliver {categoryName ? `"${categoryName}"` : "this category"} to your current location yet.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-3 space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
          <Sparkles size={14} className="text-amber-500" />
          {categoryName ? `${categoryName} stores near you` : "Stores near you"}
        </h3>
        <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
          {sellers.length} {sellers.length === 1 ? "store" : "stores"}
        </span>
      </div>

      {sellers.map((seller, index) => {
        const bannerUrl =
          seller.bannerImage ||
          seller.shopBanner ||
          seller.topProducts?.[0]?.image ||
          FALLBACK_BANNERS[index % FALLBACK_BANNERS.length];

        const logoUrl = seller.logo || seller.shopLogo;
        const rating = seller.rating || (4.0 + (index % 8) * 0.1).toFixed(1);
        const estTime = seller.deliveryTime || `${Math.max(10, Math.round((seller.distance || 2) * 4 + 10))}-${Math.max(15, Math.round((seller.distance || 2) * 4 + 18))} mins`;

        return (
          <div
            key={seller._id}
            onClick={() => handleSellerClick(seller)}
            className="group relative bg-white rounded-3xl border border-slate-300/90 hover:border-slate-400 shadow-[0_8px_30px_rgb(0,0,0,0.07)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1 transition-all duration-300 overflow-hidden cursor-pointer active:scale-[0.995]"
          >
            {/* Zomato-style Cover Banner Image */}
            <div className="relative h-36 sm:h-44 w-full overflow-hidden bg-slate-100">
              <img
                src={bannerUrl}
                alt={seller.shopName}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              {/* Subtle Gradient Overlay for badge legibility */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/10" />

              {/* Top Badges (Distance & Delivery Time) */}
              <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                <span className="bg-emerald-600/95 backdrop-blur-md text-white text-[10.5px] font-extrabold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">
                  <Clock size={11} className="stroke-[2.5]" />
                  {estTime}
                </span>
                {Number.isFinite(seller.distance) && (
                  <span className="bg-black/60 backdrop-blur-md text-white text-[10.5px] font-black px-2.5 py-1 rounded-full border border-white/20 shadow-sm flex items-center gap-1">
                    <MapPin size={11} className="text-amber-400 stroke-[2.5]" />
                    {seller.distance.toFixed(1)} km
                  </span>
                )}
              </div>

              {/* Floating Shop Logo / Avatar Badge */}
              <div className="absolute -bottom-3 left-4 w-14 h-14 rounded-2xl border-2 border-white bg-white shadow-md flex items-center justify-center overflow-hidden z-20 shrink-0">
                {logoUrl ? (
                  <img src={logoUrl} alt={seller.shopName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white font-black text-lg">
                    {seller.shopName?.charAt(0).toUpperCase() || <Store size={22} />}
                  </div>
                )}
              </div>
            </div>

            {/* Shop Details Body */}
            <div className="pt-4 px-4 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base sm:text-lg font-black text-slate-900 leading-tight group-hover:text-primary transition-colors truncate">
                      {seller.shopName}
                    </h4>
                  </div>
                  <p className="text-xs font-medium text-slate-500 truncate flex items-center gap-1 mt-1">
                    <MapPin size={12} className="shrink-0 text-slate-400" />
                    {seller.address || seller.locality || seller.city || "Nearby Store"}
                  </p>
                </div>

                {/* Rating Badge (Zomato Green Badge) */}
                <div className="shrink-0 flex items-center gap-1 bg-emerald-700 text-white text-xs font-black px-2 py-0.5 rounded-lg shadow-xs">
                  <span>{rating}</span>
                  <Star size={11} className="fill-white stroke-none" />
                </div>
              </div>

              {/* Bestseller Dishes / Products Preview Strip (Zomato-Style) */}
              {seller.topProducts && seller.topProducts.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                      <Flame size={11} className="text-orange-500" />
                      Popular Items
                    </span>
                    <span className="text-[10px] font-bold text-primary flex items-center">
                      Explore store <ChevronRight size={12} />
                    </span>
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    {seller.topProducts.map((prod) => (
                      <div
                        key={prod._id}
                        className="flex-shrink-0 flex items-center gap-2 bg-slate-50 border border-slate-100/90 rounded-xl p-1.5 hover:bg-slate-100/80 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg bg-white overflow-hidden shrink-0 border border-slate-100">
                          {prod.image ? (
                            <img src={prod.image} alt={prod.name} className="w-full h-full object-contain p-0.5" />
                          ) : (
                            <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-300 text-[10px]">
                              Img
                            </div>
                          )}
                        </div>
                        <div className="pr-1 max-w-[90px]">
                          <p className="text-[10.5px] font-bold text-slate-800 truncate leading-snug">
                            {prod.name}
                          </p>
                          <p className="text-[10px] font-extrabold text-slate-900 mt-0.5">
                            ₹{prod.price}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default QuickCategorySellersSection;
