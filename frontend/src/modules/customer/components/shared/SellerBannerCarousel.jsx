import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";

const AUTOPLAY_MS = 4000;

// Small self-contained carousel for a seller's storefront cover banners.
// Autoplays and supports swipe; falls back to rendering nothing if no
// images are given (caller decides the fallback image/placeholder).
const SellerBannerCarousel = ({ images = [], alt = "", className = "" }) => {
  const total = images.length;
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((prev) => (prev >= total ? 0 : prev));
  }, [total]);

  useEffect(() => {
    if (total <= 1) return undefined;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % total);
    }, AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [total]);

  if (total === 0) return null;

  const handleDragEnd = (_event, info) => {
    const threshold = 50;
    if (info.offset.x < -threshold) {
      setActiveIndex((prev) => Math.min(prev + 1, total - 1));
    } else if (info.offset.x > threshold) {
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    }
  };

  return (
    <div className={cn("relative w-full h-full overflow-hidden", className)}>
      <motion.div
        className="flex h-full"
        animate={{ x: `-${activeIndex * 100}%` }}
        transition={{ type: "tween", duration: 0.45, ease: "easeInOut" }}
        drag={total > 1 ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
      >
        {images.map((img, idx) => (
          <div key={`${img}-${idx}`} className="h-full w-full shrink-0">
            <img
              src={applyCloudinaryTransform(img, "f_auto,q_auto,w_800")}
              alt={alt}
              loading={idx === 0 ? "eager" : "lazy"}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        ))}
      </motion.div>

      {total > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
          {images.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                idx === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/50"
              )}
              aria-label={`Go to banner ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SellerBannerCarousel;
