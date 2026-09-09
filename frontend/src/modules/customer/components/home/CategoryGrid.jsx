import React from "react";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";

// "Shop by category" grid, shown below the hero banner. Replaces the old
// single-row scrollable category strip that used to live in the header —
// tapping a tile now navigates to the sellers list for that category
// instead of switching the home page in place.
const CategoryGrid = ({ categories = [], onCategorySelect }) => {
  if (!categories.length) return null;

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-2 gap-y-4">
        {categories.map((cat) => {
          const catIconColor = cat.headerIconColor || "#111111";
          const customImg =
            cat.image ||
            (typeof cat.icon === "string" && (cat.icon.startsWith("http") || cat.icon.includes("/"))
              ? cat.icon
              : null);

          return (
            <button
              key={cat.id || cat._id}
              type="button"
              onClick={() => onCategorySelect && onCategorySelect(cat)}
              className="flex flex-col items-center gap-1.5 cursor-pointer group active:scale-95 transition-transform"
            >
              <div
                className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-100/80 bg-white shadow-sm transition-all group-hover:shadow-md group-hover:-translate-y-0.5 md:h-[72px] md:w-[72px]"
                style={{ backgroundColor: customImg ? "#ffffff" : `${catIconColor}12` }}
              >
                {customImg ? (
                  <img
                    src={applyCloudinaryTransform(customImg, "f_auto,q_auto,w_200")}
                    alt={cat.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : typeof cat.icon === "function" || (typeof cat.icon === "object" && cat.icon?.$$typeof) ? (
                  <cat.icon sx={{ fontSize: 32, color: catIconColor }} />
                ) : (
                  <span className="text-[30px] leading-none">{cat.icon || "✨"}</span>
                )}
              </div>
              <span className="max-w-[76px] truncate text-center text-[11px] font-bold uppercase tracking-tight text-slate-700">
                {cat.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryGrid;
