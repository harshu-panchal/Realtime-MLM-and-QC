import React from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, Search } from "lucide-react";
import QuickCategorySellersSection from "../components/home/QuickCategorySellersSection";

const CategorySellersPage = () => {
  const { categoryId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const categoryName = state?.categoryName || "";

  return (
    <div className="min-h-screen bg-white pb-16 md:pt-[80px] font-sans">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-2 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-1 -ml-1 hover:bg-slate-50 rounded-full transition-all shrink-0"
          >
            <ChevronLeft size={24} className="text-gray-900" />
          </button>
          <h1 className="text-[18px] font-black text-gray-900 tracking-tight truncate">
            {categoryName ? `${categoryName} Stores` : "Stores Near You"}
          </h1>
        </div>
        <button
          onClick={() => navigate("/search")}
          className="p-1.5 hover:bg-slate-50 rounded-full transition-all shrink-0"
        >
          <Search size={22} className="text-gray-900" strokeWidth={2.5} />
        </button>
      </div>

      <div className="max-w-[720px] mx-auto">
        <QuickCategorySellersSection categoryId={categoryId} categoryName={categoryName} />
      </div>
    </div>
  );
};

export default CategorySellersPage;
