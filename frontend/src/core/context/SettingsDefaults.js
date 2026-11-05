/** Default fallbacks when settings are not yet loaded or API fails */
export const DEFAULT_SETTINGS = {
  appName: "App",
  supportEmail: "",
  supportPhone: "",
  currencySymbol: "\u20B9",
  currencyCode: "INR",
  timezone: "Asia/Kolkata",
  logoUrl: "",
  faviconUrl: "",
  customerSplashImage: "",
  deliverySplashImage: "",
  primaryColor: "var(--primary)",
  secondaryColor: "#64748b",
  companyName: "",
  taxId: "",
  address: "",
  facebook: "",
  twitter: "",
  instagram: "",
  linkedin: "",
  youtube: "",
  playStoreLink: "",
  appStoreLink: "",
  metaTitle: "",
  metaDescription: "",
  metaKeywords: "",
  keywords: [],
  returnDeliveryCommission: 0,
  deliveryPricingMode: "distance_based",
  pricingMode: "distance_based",
  customerBaseDeliveryFee: 30,
  riderBasePayout: 30,
  riderBaseEarning: 25,
  baseDeliveryCharge: 30,
  baseDistanceCapacityKm: 0.5,
  incrementalKmSurcharge: 10,
  deliveryPartnerRatePerKm: 5,
  fleetCommissionRatePerKm: 5,
  fixedDeliveryFee: 30,
  handlingFeeStrategy: "highest_category_fee",
  codEnabled: true,
  onlineEnabled: true,
  lowStockAlertsEnabled: true,
  productApproval: {
    sellerCreateRequiresApproval: false,
    sellerEditRequiresApproval: false,
  },
};

/**
 * Applies theme CSS variables to document root from settings.
 */
export function applyThemeVariables(settings) {
  if (!settings) return;
  const root = document.documentElement;
  const primary = settings.primaryColor || DEFAULT_SETTINGS.primaryColor;
  const secondary = settings.secondaryColor || DEFAULT_SETTINGS.secondaryColor;
  
  // Setting "--primary" to "var(--primary)" is a self-reference that makes the
  // variable invalid (all brand colors vanish), so only apply real color values.
  const isRealColor = (c) => typeof c === "string" && c.trim() && !c.trim().startsWith("var(");

  // Brightness (YIQ 0-255) of a hex color, or null if it isn't a hex color.
  const brightness = (c) => {
    let hex = String(c).trim().replace("#", "");
    if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000;
  };

  // A white / near-white primary makes every brand button (white text on
  // bg-brand-600) unreadable, so ignore it and keep the default brand blue.
  const primaryBrightness = isRealColor(primary) ? brightness(primary) : null;
  const primaryUsable = isRealColor(primary) && !(primaryBrightness !== null && primaryBrightness >= 235);

  if (primaryUsable) {
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--primary-color", primary);
    if (primaryBrightness !== null) {
      root.style.setProperty("--primary-foreground", primaryBrightness >= 160 ? "#000000" : "#FFFFFF");
    }
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-color");
    root.style.removeProperty("--primary-foreground");
  }

  if (isRealColor(secondary)) {
    root.style.setProperty("--secondary", secondary);
    root.style.setProperty("--secondary-color", secondary);
  }
}

