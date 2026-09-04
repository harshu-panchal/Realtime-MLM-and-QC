import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft, Store } from "lucide-react";
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

  const activeProducts = productsByCategory[activeCategoryId] || [];
  const isLoading = isLoadingMeta || (isLoadingProducts && activeProducts.length === 0);

  return (
    <div className="bg-white min-h-screen w-full max-w-md mx-auto relative font-sans pb-24">
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100 h-14 flex items-center justify-center px-4">
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 p-1 hover:bg-gray-50 rounded-full transition-colors flex items-center justify-center"
        >
          <ChevronLeft size={24} className="text-gray-900" />
        </button>
        <h1 className="text-base font-bold text-gray-800 tracking-tight truncate px-8">
          {seller?.shopName || "Store"}
        </h1>
      </header>

      {!isLoadingMeta && !seller ? (
        <div className="w-full flex-1 py-20 px-8 flex flex-col items-center justify-center text-center">
          <Store className="text-gray-300 mb-4" size={56} />
          <h3 className="text-xl font-black text-slate-800 mb-2">Store not found</h3>
          <p className="text-slate-500 font-bold text-sm max-w-[280px]">
            This store may no longer be active.
          </p>
        </div>
      ) : (
        <div>
          {seller?.address && (
            <p className="px-4 pt-3 text-xs text-gray-500 font-semibold truncate">
              {seller.address}
            </p>
          )}

          {categories.length > 0 && (
            <div className="sticky top-14 z-40 bg-white border-b border-gray-100 shadow-sm px-4 py-2.5 flex overflow-x-auto hide-scrollbar gap-3 w-full mt-2">
              {categories.map((cat) => (
                <button
                  key={cat._id}
                  onClick={() => setActiveCategoryId(cat._id)}
                  className={cn(
                    "flex items-center px-5 py-2 rounded-xl whitespace-nowrap font-bold text-sm transition-all duration-200",
                    activeCategoryId === cat._id
                      ? "bg-primary text-white shadow-md shadow-primary/20 scale-[1.02]"
                      : "bg-gray-100/80 text-gray-600 hover:bg-gray-200",
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="px-3 pt-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : activeProducts.length === 0 ? (
            <div className="w-full flex-1 py-16 px-8 flex flex-col items-center justify-center text-center">
              <div className="w-48 h-48 mb-4">
                {noServiceData ? (
                  <Lottie animationData={noServiceData} loop />
                ) : (
                  <div className="w-48 h-48" />
                )}
              </div>
              <p className="text-slate-500 font-bold text-sm">
                No products in this category yet.
              </p>
            </div>
          ) : (
            <div className="px-3 pt-2 w-full">
              {activeProducts.map((product) => (
                <ProductCard key={product.id} product={product} layout="list" />
              ))}
            </div>
          )}
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
