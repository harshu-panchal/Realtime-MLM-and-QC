import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft, Search, X, Flame, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { customerApi } from "../services/customerApi";
import { useLocation as useAppLocation } from "../context/LocationContext";
import ProductCard from "../components/shared/ProductCard";
import ProductDetailSheet from "../components/shared/ProductDetailSheet";
import MiniCart from "../components/shared/MiniCart";
import Lottie from "lottie-react";

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

// Products for a single category of a seller's storefront — subcategory
// sidebar on the left, product grid on the right. Reached by tapping a
// category card on SellerStorefrontPage.
const SellerCategoryProductsPage = () => {
  const { sellerId, categoryId } = useParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const { currentLocation } = useAppLocation();

  const [categoryName, setCategoryName] = useState(routerLocation.state?.categoryName || "");
  const [shopName, setShopName] = useState(routerLocation.state?.shopName || "");
  const [subcategories, setSubcategories] = useState([]);
  const [activeSubcategoryId, setActiveSubcategoryId] = useState(null);
  const [productsByKey, setProductsByKey] = useState({});
  const [isLoadingMeta, setIsLoadingMeta] = useState(!routerLocation.state?.categoryName);
  const [isLoadingSubcategories, setIsLoadingSubcategories] = useState(true);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [noServiceData, setNoServiceData] = useState(null);

  useEffect(() => {
    import("@/assets/lottie/animation.json")
      .then((m) => setNoServiceData(m.default))
      .catch(() => {});
  }, []);

  // Only needed as a fallback when the category name wasn't passed via
  // router state (e.g. direct link / page refresh).
  useEffect(() => {
    if (categoryName && shopName) return;
    let cancelled = false;
    setIsLoadingMeta(true);
    customerApi
      .getSellerStorefrontMeta(sellerId)
      .then((res) => {
        if (cancelled) return;
        const result = res.data?.result || {};
        setShopName((prev) => prev || result.seller?.shopName || "Store");
        const cats = Array.isArray(result.categories) ? result.categories : [];
        const match = cats.find((c) => c._id === categoryId);
        if (match) setCategoryName((prev) => prev || match.name);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sellerId, categoryId, categoryName, shopName]);

  // Subcategories of this category — shown in the left sidebar.
  useEffect(() => {
    if (!categoryId) return;
    let cancelled = false;
    setIsLoadingSubcategories(true);
    setActiveSubcategoryId(null);
    customerApi
      .getCategories({
        type: "subcategory",
        parentId: categoryId,
        page: 1,
        limit: 100,
      })
      .then((res) => {
        if (cancelled) return;
        const result = res.data?.result;
        const items = Array.isArray(result?.items) ? result.items : [];
        setSubcategories(items);
      })
      .catch(() => {
        if (!cancelled) setSubcategories([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSubcategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const productsKey = `${categoryId || ""}::${activeSubcategoryId || "all"}`;

  useEffect(() => {
    if (!categoryId) return;
    if (productsByKey[productsKey]) return;

    const hasValidLocation =
      Number.isFinite(currentLocation?.latitude) &&
      Number.isFinite(currentLocation?.longitude);
    if (!hasValidLocation) return;

    let cancelled = false;
    setIsLoadingProducts(true);
    const params = {
      sellerId,
      categoryId,
      mode: "quick",
      lat: currentLocation.latitude,
      lng: currentLocation.longitude,
    };
    if (activeSubcategoryId) params.subcategoryId = activeSubcategoryId;

    customerApi
      .getProducts(params)
      .then((res) => {
        if (cancelled) return;
        const result = res.data?.result;
        const items = Array.isArray(result?.items) ? result.items : [];
        setProductsByKey((prev) => ({
          ...prev,
          [productsKey]: items.map(formatProduct),
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setProductsByKey((prev) => ({ ...prev, [productsKey]: [] }));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categoryId, activeSubcategoryId, productsKey, sellerId, currentLocation?.latitude, currentLocation?.longitude]);

  const rawActiveProducts = productsByKey[productsKey] || [];

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return rawActiveProducts;
    const query = searchQuery.toLowerCase();
    return rawActiveProducts.filter(
      (p) =>
        p.name?.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query),
    );
  }, [rawActiveProducts, searchQuery]);

  const isLoading = isLoadingMeta || (isLoadingProducts && rawActiveProducts.length === 0);

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
            {categoryName || "Category"}
          </h1>
          {shopName && (
            <p className="text-[10.5px] font-semibold text-slate-400 truncate flex items-center justify-center gap-1">
              <Store size={10} className="shrink-0" /> {shopName}
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

      {/* In-Store Search Bar (Collapsible / Dynamic) */}
      {isSearching && (
        <div className="mx-4 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="relative flex items-center bg-white border border-slate-200 rounded-2xl shadow-sm px-3.5 h-11">
            <Search size={16} className="text-slate-400 mr-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search in ${categoryName || "category"}...`}
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

      {/* Subcategory Sidebar + Products Grid (two-pane, Blinkit style) */}
      <div className="flex mt-3">
        {subcategories.length > 0 && (
          <div className="w-[76px] sm:w-24 shrink-0 sticky top-14 self-start max-h-[calc(100vh-56px)] overflow-y-auto bg-white border-r border-slate-100 hide-scrollbar">
            <button
              onClick={() => setActiveSubcategoryId(null)}
              className={cn(
                "relative w-full flex flex-col items-center gap-1.5 px-1.5 py-3 text-center transition-colors",
                activeSubcategoryId === null ? "bg-slate-50" : "bg-white hover:bg-slate-50/60"
              )}
            >
              {activeSubcategoryId === null && (
                <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary" />
              )}
              <div
                className={cn(
                  "w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border bg-slate-50",
                  activeSubcategoryId === null ? "border-primary/60 shadow-sm" : "border-slate-100"
                )}
              >
                <span className="text-lg">🛍️</span>
              </div>
              <span
                className={cn(
                  "text-[10px] leading-tight",
                  activeSubcategoryId === null ? "font-black text-slate-900" : "font-semibold text-slate-500"
                )}
              >
                All
              </span>
            </button>

            {subcategories.map((sub) => {
              const isActive = activeSubcategoryId === sub._id;
              return (
                <button
                  key={sub._id}
                  onClick={() => setActiveSubcategoryId(sub._id)}
                  className={cn(
                    "relative w-full flex flex-col items-center gap-1.5 px-1.5 py-3 text-center transition-colors",
                    isActive ? "bg-slate-50" : "bg-white hover:bg-slate-50/60"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary" />
                  )}
                  <div
                    className={cn(
                      "w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0 border bg-slate-50",
                      isActive ? "border-primary/60 shadow-sm" : "border-slate-100"
                    )}
                  >
                    {sub.image ? (
                      <img src={sub.image} alt={sub.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-lg">🛒</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[10px] leading-tight line-clamp-2",
                      isActive ? "font-black text-slate-900" : "font-semibold text-slate-500"
                    )}
                  >
                    {sub.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Products List Section */}
        <div className="flex-1 min-w-0 px-1.5 pt-1 pb-3">
          {isLoading ? (
            <div className="grid grid-cols-2 gap-1.5 pt-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-2xl bg-white border border-slate-200/60 p-2.5 animate-pulse">
                  <div className="w-full aspect-square bg-slate-100 rounded-xl" />
                  <div className="space-y-2 mt-2">
                    <div className="h-3.5 bg-slate-100 rounded-lg w-3/4" />
                    <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
                    <div className="h-3.5 bg-slate-100 rounded-lg w-1/3 mt-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="w-full py-16 px-4 flex flex-col items-center justify-center text-center">
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
            <div className="pt-1">
              <div className="flex items-center justify-between px-1 mb-2">
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Flame size={13} className="text-orange-500" />
                  {(activeSubcategoryId
                    ? subcategories.find((s) => s._id === activeSubcategoryId)?.name
                    : categoryName) || "Menu Items"}{" "}
                  ({filteredProducts.length})
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} layout="storefront" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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

export default SellerCategoryProductsPage;
