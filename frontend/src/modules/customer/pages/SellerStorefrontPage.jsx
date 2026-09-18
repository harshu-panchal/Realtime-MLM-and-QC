import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  Store,
  MapPin,
  Star,
  Clock,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { customerApi } from "../services/customerApi";
import SellerBannerCarousel from "../components/shared/SellerBannerCarousel";

const FALLBACK_BANNERS = [
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1000&q=80",
  "https://images.unsplash.com/photo-1506617420156-8e4536971650?auto=format&fit=crop&w=1000&q=80",
  "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1000&q=80",
];

// Quick tab seller storefront: shows the store info and its categories as a
// grid of cards. Tapping a category navigates to SellerCategoryProductsPage,
// which shows that category's subcategory sidebar + product grid.
const SellerStorefrontPage = () => {
  const { sellerId } = useParams();
  const navigate = useNavigate();

  const [seller, setSeller] = useState(null);
  const [categories, setCategories] = useState([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingMeta(true);
    customerApi
      .getSellerStorefrontMeta(sellerId)
      .then((res) => {
        if (cancelled) return;
        const result = res.data?.result || {};
        setSeller(result.seller || null);
        const cats = Array.isArray(result.categories) ? result.categories : [];
        setCategories(cats);
      })
      .catch(() => {
        if (!cancelled) {
          setSeller(null);
          setCategories([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sellerId]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const query = searchQuery.toLowerCase();
    return categories.filter((c) => c.name?.toLowerCase().includes(query));
  }, [categories, searchQuery]);

  const handleCategoryClick = (cat) => {
    navigate(`/quick/seller/${sellerId}/category/${cat._id}`, {
      state: { categoryName: cat.name, shopName: seller?.shopName },
    });
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: seller?.shopName || "Storefront",
          url: window.location.href,
        });
      } catch (err) {}
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("Store link copied to clipboard!");
    }
  };

  const bannerImages =
    Array.isArray(seller?.bannerImages) && seller.bannerImages.length > 0
      ? seller.bannerImages
      : seller?.bannerImage
      ? [seller.bannerImage]
      : seller?.shopBanner
      ? [seller.shopBanner]
      : FALLBACK_BANNERS;

  const logoUrl = seller?.logo || seller?.shopLogo;
  const rating = seller?.rating || "4.3";
  const estTime = seller?.deliveryTime || "15-25 mins";

  return (
    <div className="bg-slate-50 min-h-screen w-full max-w-lg mx-auto relative font-sans pb-28">
      {/* Sticky Top Header Bar */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/60 h-14 flex items-center justify-between px-4 transition-all">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors flex items-center justify-center text-slate-800"
        >
          <ChevronLeft size={22} className="stroke-[2.5]" />
        </button>

        <div className="flex-1 text-center min-w-0 px-2">
          <h1 className="text-base font-black text-slate-900 tracking-tight truncate">
            {seller?.shopName || "Store"}
          </h1>
          {seller?.address && (
            <p className="text-[10.5px] font-semibold text-slate-400 truncate">
              {seller.address}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsSearching(!isSearching)}
            className={cn(
              "p-2 rounded-full transition-colors flex items-center justify-center text-slate-700",
              isSearching ? "bg-slate-100 text-primary" : "hover:bg-slate-100"
            )}
          >
            <Search size={18} />
          </button>
        </div>
      </header>

      {!isLoadingMeta && !seller ? (
        <div className="w-full flex-1 py-24 px-8 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mb-4 text-slate-400">
            <Store size={44} />
          </div>
          <h3 className="text-xl font-black text-slate-800 mb-1">Store not found</h3>
          <p className="text-slate-500 font-bold text-sm max-w-[280px]">
            This store may no longer be active or available in your area.
          </p>
          <button
            onClick={() => navigate("/")}
            className="mt-6 px-6 py-2.5 bg-primary text-white font-black text-xs rounded-xl shadow-md"
          >
            Go to Home
          </button>
        </div>
      ) : (
        <div>
          {/* Cover Banner Header (carousel when the seller has multiple) */}
          <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-slate-100">
            <SellerBannerCarousel images={bannerImages} alt={seller?.shopName} className="absolute inset-0" />
            {/* Subtle Gradient Overlay for badge contrast */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/10 pointer-events-none" />

            {/* Banner Top Badges */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
              <span className="bg-emerald-600/95 backdrop-blur-md text-white text-[10.5px] font-extrabold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">
                <Clock size={11} className="stroke-[2.5]" />
                {estTime}
              </span>
              <span className="bg-black/60 backdrop-blur-md text-white text-[10.5px] font-black px-2.5 py-1 rounded-full border border-white/20 shadow-sm flex items-center gap-1">
                <MapPin size={11} className="text-amber-400 stroke-[2.5]" />
                {seller?.serviceRadius || 5} km radius
              </span>
            </div>
          </div>

          {/* Floating Zomato Store Card */}
          <div className="-mt-12 mx-4 relative z-20 bg-white rounded-3xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.09)] border border-slate-200">
            {/* Shop Logo Avatar */}
            <div className="absolute -top-7 left-4 w-14 h-14 rounded-2xl border-2 border-white bg-white shadow-md flex items-center justify-center overflow-hidden z-20">
              {logoUrl ? (
                <img src={logoUrl} alt={seller?.shopName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white font-black text-lg">
                  {seller?.shopName?.charAt(0).toUpperCase() || <Store size={22} />}
                </div>
              )}
            </div>

            <div className="pt-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-black text-slate-900 leading-tight truncate">
                    {seller?.shopName}
                  </h2>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5 truncate flex items-center gap-1">
                    <Sparkles size={12} className="text-amber-500 shrink-0" />
                    {seller?.category || "Quick Commerce Store"} • Express Delivery
                  </p>
                </div>

                {/* Zomato Rating Badge */}
                <div className="shrink-0 flex items-center gap-1 bg-emerald-700 text-white text-xs font-black px-2.5 py-1 rounded-xl shadow-xs">
                  <span>{rating}</span>
                  <Star size={11} className="fill-white stroke-none" />
                </div>
              </div>

              {/* Address */}
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="truncate flex items-center gap-1 font-medium">
                  <MapPin size={13} className="text-slate-400 shrink-0" />
                  {seller?.address || seller?.locality || seller?.city || "Nearby location"}
                </span>
              </div>

            </div>
          </div>

          {/* In-Store Search Bar (Collapsible / Dynamic) */}
          {isSearching && (
            <div className="mx-4 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl shadow-sm px-3.5 h-11">
                <Search size={16} className="text-slate-400 mr-2 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search in ${seller?.shopName || "store"}...`}
                  autoFocus
                  className="w-full bg-transparent text-xs font-bold text-slate-800 placeholder:text-slate-400 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-slate-400 p-1">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Categories Grid — tap a category to see its products */}
          <div className="px-4 pt-4">
            {categories.length === 0 ? (
              !isLoadingMeta && (
                <div className="w-full py-16 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center mb-4 text-slate-400">
                    <Store size={30} />
                  </div>
                  <p className="text-slate-700 font-extrabold text-sm">No categories available in this store</p>
                </div>
              )
            ) : (
              <div className="grid grid-cols-4 gap-3 pb-4">
                {filteredCategories.map((cat) => (
                  <button
                    key={cat._id}
                    onClick={() => handleCategoryClick(cat)}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <div className="w-full aspect-square rounded-2xl overflow-hidden flex items-center justify-center border border-slate-200/80 bg-slate-50 shadow-2xs hover:shadow-md transition-all duration-200">
                      {cat.image ? (
                        <img src={cat.image} alt={cat.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">🛒</span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-700 leading-tight text-center line-clamp-2">
                      {cat.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SellerStorefrontPage;
