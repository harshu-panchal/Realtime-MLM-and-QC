import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { getJSON, setJSON, STORAGE_KEYS } from "@core/utils/storage";

const CommerceModeContext = createContext(undefined);

export const COMMERCE_MODES = Object.freeze({
  QUICK: "quick",
  SHOP_ALL: "shopAll",
});

const isValidMode = (value) =>
  value === COMMERCE_MODES.QUICK || value === COMMERCE_MODES.SHOP_ALL;

// Quick = hyperlocal, radius-gated Quick Commerce sellers.
// ShopAll = nationwide E-commerce sellers, no location dependency.
export const CommerceModeProvider = ({ children }) => {
  const [mode, setModeState] = useState(() => {
    const stored = getJSON(STORAGE_KEYS.COMMERCE_MODE, COMMERCE_MODES.QUICK);
    return isValidMode(stored) ? stored : COMMERCE_MODES.QUICK;
  });

  const setMode = useCallback((nextMode) => {
    if (!isValidMode(nextMode)) return;
    setModeState(nextMode);
    setJSON(STORAGE_KEYS.COMMERCE_MODE, nextMode);
  }, []);

  const value = useMemo(
    () => ({
      mode,
      setMode,
      isQuick: mode === COMMERCE_MODES.QUICK,
      isShopAll: mode === COMMERCE_MODES.SHOP_ALL,
    }),
    [mode, setMode],
  );

  return (
    <CommerceModeContext.Provider value={value}>
      {children}
    </CommerceModeContext.Provider>
  );
};

export const useCommerceMode = () => {
  const ctx = useContext(CommerceModeContext);
  if (ctx === undefined) {
    throw new Error("useCommerceMode must be used within a CommerceModeProvider");
  }
  return ctx;
};
