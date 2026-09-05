import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ChevronLeft,
  Store,
  MapPin,
  Star,
  Clock,
  Search,
  Sparkles,
  Tag,
  X,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { customerApi } from "../services/customerApi";
import { useLocation as useAppLocation } from "../context/LocationContext";
import ProductCard from "../components/shared/ProductCard";
import ProductDetailSheet from "../components/shared/ProductDetailSheet";
import MiniCart from "../components/shared/MiniCart";
import Lottie from "lottie-react";

const FALLBACK_BANNERS = [
  "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1000&q=80",
  "https://images.unsplash.com/photo-1506617420156-8e4536971650?auto=format&fit=crop&w=1000&q=80",
  "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1000&q=80",
];

const formatProduct = (p) => ({
  ...p,
  id: p._id,
  image:
    p.mainImage ||
    p.image ||
    "https://images.unsplash.com/photo-1550989460-0adf9ea622e2?auto=format&fit=crop&q=80&w=400&h=400",
  price: p.salePrice || p.price,
  originalPrice: p.price,
  weight: p.weight || "1 unit",
  deliveryTime: "8-15 mins",
});

// Quick tab seller storefront: full store browse with category tabs,
// defaulting to whichever category the customer clicked in from the
// nearby-sellers list page.
const SellerStorefrontPage = () => {
  const { sellerId } = useParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { currentLocation } = useAppLocation();
  const initialCategoryId = routerLocation.state?.categoryId || null;

  const [seller, setSeller] = useState(null);
  const [categories, setCategories] = useState([]);
  const [activeCategoryId, setActiveCategoryId] = useState(initialCategoryId);
  const [productsByCategory, setProductsByCategory] = useState({});
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [noServiceData, setNoServiceData] = useState(null);

  useEffect(() => {
    import("@/assets/lottie/animation.json")
      .then((m) => setNoServiceData(m.default))
      .catch(() => {});
  }, []);

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
        setActiveCategoryId((prev) => {
          if (prev && cats.some((c) => c._id === prev)) return prev;
          return cats[0]?._id || null;
        });
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

  useEffect(() => {
    if (!activeCategoryId) return;
    if (productsByCategory[activeCategoryId]) return;

    const hasValidLocation =
      Number.isFinite(currentLocation?.latitude) &&
      Number.isFinite(currentLocation?.longitude);
    if (!hasValidLocation) return;

    let cancelled = false;
    setIsLoadingProducts(true);
    customerApi
      .getProducts({
        sellerId,
        categoryId: activeCategoryId,
        mode: "quick",
        lat: currentLocation.latitude,
        lng: currentLocation.longitude,
      })
      .then((res) => {
        if (cancelled) return;
        const result = res.data?.result;
        const items = Array.isArray(result?.items) ? result.items : [];
        setProductsByCategory((prev) => ({
          ...prev,
          [activeCategoryId]: items.map(formatProduct),
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setProductsByCategory((prev) => ({ ...prev, [activeCategoryId]: [] }));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCategoryId, sellerId, currentLocation?.latitude, currentLocation?.longitude]);

  const rawActiveProducts = productsByCategory[activeCategoryId] || [];
  
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return rawActiveProducts;
    const query = searchQuery.toLowerCase();
    return rawActiveProducts.filter((p) =>
      p.name?.toLowerCase().includes(query) ||
      p.description?.toLowerCase().includes(query)
    );
  }, [rawActiveProducts, searchQuery]);

  const isLoading = isLoadingMeta || (isLoadingProducts && rawActiveProducts.length === 0);

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

  const bannerUrl =
    seller?.bannerImage ||
    seller?.shopBanner ||
    FALLBACK_BANNERS[0];

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
          {/* Cover Banner Header */}
          <div className="relative h-44 sm:h-52 w-full overflow-hidden bg-slate-100">
            <img
              src={bannerUrl}
              alt={seller?.shopName}
              className="w-full h-full object-cover"
            />
            {/* Subtle Gradient Overlay for badge contrast */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/10" />

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

              {/* Offer Banner Strip */}
              {(seller?.offerTitle || seller?.offerSubtitle) && (
                <div className="mt-3 bg-orange-50/90 border border-orange-200/80 rounded-2xl p-2.5 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0">
                    <Tag size={14} className="stroke-[2.5]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {seller.offerTitle && (
                      <p className="text-xs font-extrabold text-orange-950 truncate">
                        {seller.offerTitle}
                      </p>
                    )}
                    {seller.offerSubtitle && (
                      <p className="text-[10px] font-semibold text-orange-600 truncate">
                        {seller.offerSubtitle}
                      </p>
                    )}
                  </div>
                </div>
              )}
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

          {/* Category Tabs (Zomato Category Menu Bar) */}
          {categories.length > 0 && (
            <div className="sticky top-14 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/60 shadow-xs px-4 py-2.5 flex overflow-x-auto hide-scrollbar gap-2 w-full mt-4">
              {categories.map((cat) => {
                const isActive = activeCategoryId === cat._id;
                return (
                  <button
                    key={cat._id}
                    onClick={() => {
                      setActiveCategoryId(cat._id);
                      setSearchQuery("");
                    }}
                    className={cn(
                      "flex items-center px-4 py-2 rounded-2xl whitespace-nowrap font-black text-xs transition-all duration-200 shrink-0",
                      isActive
                        ? "bg-slate-900 text-white shadow-md scale-[1.02]"
                        : "bg-white border border-slate-200/80 text-slate-600 hover:bg-slate-100"
                    )}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Products List Section */}
          <div className="px-4 pt-3">
            {isLoading ? (
              <div className="space-y-3 pt-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-28 rounded-3xl bg-white border border-slate-200/60 p-3 animate-pulse flex gap-3">
                    <div className="w-20 h-20 bg-slate-100 rounded-2xl shrink-0" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-4 bg-slate-100 rounded-lg w-3/4" />
                      <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
                      <div className="h-4 bg-slate-100 rounded-lg w-1/4 mt-4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="w-full py-16 px-8 flex flex-col items-center justify-center text-center">
                <div className="w-40 h-40 mb-3">
                  {noServiceData ? (
                    <Lottie animationData={noServiceData} loop />
                  ) : (
                    <div className="w-40 h-40 bg-slate-100 rounded-full" />
                  )}
                </div>
                <p className="text-slate-700 font-extrabold text-sm">
                  {searchQuery ? `No items matching "${searchQuery}"` : "No products available in this category"}
                </p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="mt-2 text-xs font-black text-primary hover:underline"
                  >
                    Clear search filter
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                    <Flame size={13} className="text-orange-500" />
                    {categories.find((c) => c._id === activeCategoryId)?.name || "Menu Items"} ({filteredProducts.length})
                  </span>
                </div>

                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} layout="list" />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <MiniCart />
      <ProductDetailSheet />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .hide-scrollbar::-webkit-scrollbar {
              display: none;
            }
            .hide-scrollbar {
              -ms-overflow-style: none;
              scrollbar-width: none;
            }
          `,
        }}
      />
    </div>
  );
};

export default SellerStorefrontPage;
