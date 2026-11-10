import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Search, Plus, Minus, Trash2, LogOut, Printer, Receipt, X, Store, Clock, Banknote, Smartphone, CreditCard, Loader2,
} from "lucide-react";
import { posApi, getPosToken, setPosToken } from "./services/posApi";
import PosReceipt, { PosPrintStyles } from "./components/PosReceipt";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const errMsg = (e, d) => e?.response?.data?.message || e?.message || d;

/* ---------------- Login ---------------- */
const PosLogin = ({ onLoggedIn }) => {
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await posApi.login({ phone, pin });
      setPosToken(res.data.result.token);
      onLoggedIn();
    } catch (err) {
      toast.error(errMsg(err, "Login failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-slate-900 text-white flex items-center justify-center"><Store size={22} /></div>
          <div>
            <h1 className="text-lg font-black text-slate-900">POS Billing</h1>
            <p className="text-xs text-slate-500">Counter login for cashiers</p>
          </div>
        </div>
        <input
          type="tel" inputMode="numeric" maxLength={10} autoFocus value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="Mobile number"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold outline-none focus:border-slate-900"
        />
        <input
          type="password" inputMode="numeric" maxLength={6} value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="PIN"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold tracking-widest outline-none focus:border-slate-900"
        />
        <button disabled={busy || phone.length !== 10 || pin.length < 4} className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm disabled:opacity-50">
          {busy ? "Signing in..." : "Login"}
        </button>
        <p className="text-[11px] text-slate-400 text-center">Your shop owner creates your login from Seller Panel → POS Billing.</p>
      </form>
    </div>
  );
};

/* ---------------- Modal ---------------- */
const Modal = ({ open, onClose, title, children, wide }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[calc(100dvh-2rem)] flex flex-col bg-white rounded-2xl shadow-2xl`}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <h3 className="font-black text-slate-900">{title}</h3>
          {onClose && <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>}
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

/* ---------------- Billing ---------------- */
const PosBilling = ({ onLogout }) => {
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiptBill, setReceiptBill] = useState(null);
  const [openingCash, setOpeningCash] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [closingCash, setClosingCash] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [closedShift, setClosedShift] = useState(null);
  const [showBills, setShowBills] = useState(false);
  const [bills, setBills] = useState([]);
  const searchRef = useRef(null);
  const searchSeq = useRef(0);

  const loadMe = useCallback(async () => {
    try {
      const res = await posApi.me();
      setCtx(res.data.result);
    } catch (err) {
      if ([401, 403].includes(err?.response?.status)) {
        toast.error(errMsg(err, "Session expired"));
        onLogout();
      } else toast.error(errMsg(err, "Failed to load POS"));
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => { loadMe(); }, [loadMe]);

  // Debounced product search.
  useEffect(() => {
    if (!ctx?.shift) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await posApi.searchProducts(query);
        if (seq === searchSeq.current) setResults(res.data.results || res.data.result || []);
      } catch (err) {
        if (seq === searchSeq.current) toast.error(errMsg(err, "Search failed"));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, ctx?.shift]);

  const subtotal = useMemo(() => r2(cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0)), [cart]);
  const discountNum = Math.min(Math.max(0, Number(discount) || 0), subtotal);
  const total = r2(subtotal - discountNum);
  const change = paymentMode === "cash" && cashReceived !== "" ? r2(Number(cashReceived) - total) : 0;

  const addToCart = (p, v = null) => {
    const stock = v ? Number(v.stock ?? 0) : Number(p.stock ?? 0);
    const key = `${p._id}|${v?.sku || ""}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if ((existing?.quantity || 0) + 1 > stock) {
        toast.error(`Only ${stock} in stock for ${p.name}${v?.name ? ` (${v.name})` : ""}`);
        return prev;
      }
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key, productId: p._id, variantSku: v?.sku || "", name: p.name, variantName: v?.name || "", unitPrice: v ? v.unitPrice : p.unitPrice, stock, quantity: 1 }];
    });
  };

  const setQty = (key, qty) => {
    setCart((prev) => prev.flatMap((l) => {
      if (l.key !== key) return [l];
      const q = Math.floor(Number(qty) || 0);
      if (q <= 0) return [];
      if (q > l.stock) {
        toast.error(`Only ${l.stock} in stock`);
        return [{ ...l, quantity: l.stock }];
      }
      return [{ ...l, quantity: q }];
    }));
  };

  // Barcode scanner / Enter: exact SKU match first, else the only result.
  const onSearchEnter = () => {
    const term = query.trim().toLowerCase();
    if (!term) return;
    for (const p of results) {
      const v = (p.variants || []).find((x) => String(x.sku).toLowerCase() === term);
      if (v) { addToCart(p, v); setQuery(""); return; }
      if (String(p.sku).toLowerCase() === term && !(p.variants || []).length) { addToCart(p); setQuery(""); return; }
    }
    if (results.length === 1 && !(results[0].variants || []).length) { addToCart(results[0]); setQuery(""); }
  };

  const resetBill = () => {
    setCart([]); setDiscount(""); setCashReceived(""); setCustomerName(""); setCustomerPhone(""); setPaymentMode("cash");
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const completeBill = async () => {
    if (!cart.length) return toast.error("Cart is empty");
    if (paymentMode === "cash" && cashReceived !== "" && Number(cashReceived) < total) return toast.error("Cash received is less than total");
    setSaving(true);
    try {
      const res = await posApi.createBill({
        items: cart.map((l) => ({ productId: l.productId, variantSku: l.variantSku, quantity: l.quantity })),
        discount: discountNum,
        paymentMode,
        cashReceived: paymentMode === "cash" ? (cashReceived === "" ? total : Number(cashReceived)) : 0,
        customerName,
        customerPhone,
      });
      setReceiptBill(res.data.result);
      resetBill();
      posApi.searchProducts(query).then((r) => setResults(r.data.results || r.data.result || [])).catch(() => {});
    } catch (err) {
      toast.error(errMsg(err, "Billing failed"));
    } finally {
      setSaving(false);
    }
  };

  // Keyboard: F2 = complete bill, Esc = focus search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F2") { e.preventDefault(); if (!saving && !receiptBill) completeBill(); }
      if (e.key === "Escape" && !receiptBill) searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openShift = async () => {
    try {
      await posApi.openShift({ openingCash: Number(openingCash) || 0 });
      toast.success("Shift opened");
      setOpeningCash("");
      await loadMe();
    } catch (err) { toast.error(errMsg(err, "Could not open shift")); }
  };

  const closeShift = async () => {
    if (closingCash === "") return toast.error("Enter the cash counted in the drawer");
    try {
      const res = await posApi.closeShift({ closingCash: Number(closingCash), note: closeNote });
      setClosedShift(res.data.result);
      setShowClose(false); setClosingCash(""); setCloseNote(""); setCart([]);
      await loadMe();
    } catch (err) { toast.error(errMsg(err, "Could not close shift")); }
  };

  const loadBills = async () => {
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const res = await posApi.listBills({ from: start.toISOString(), limit: 50 });
      setBills(res.data.result?.items || []);
      setShowBills(true);
    } catch (err) { toast.error(errMsg(err, "Could not load bills")); }
  };

  const cancelBill = async (bill) => {
    const reason = window.prompt(`Cancel bill ${bill.billNumber}? Enter reason:`);
    if (reason === null) return;
    try {
      await posApi.cancelBill(bill._id, reason);
      toast.success("Bill cancelled, stock returned");
      loadBills();
    } catch (err) { toast.error(errMsg(err, "Could not cancel bill")); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (!ctx) return null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <PosPrintStyles />
      {/* Header */}
      <header className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Store size={20} className="shrink-0" />
          <div className="min-w-0">
            <p className="font-black truncate">{ctx.shop.shopName}</p>
            <p className="text-[11px] text-slate-300 truncate">{ctx.counter.name} ({ctx.counter.code}) • {ctx.staff.name} • {ctx.staff.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {ctx.shift && (
            <span className="text-[11px] bg-white/10 px-2 py-1 rounded-lg flex items-center gap-1">
              <Clock size={12} /> Shift since {new Date(ctx.shift.openedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} • {ctx.shift.totals?.billCount || 0} bills • {inr(ctx.shift.totals?.grandTotal)}
            </span>
          )}
          <button onClick={loadBills} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1"><Receipt size={14} /> Bills</button>
          {ctx.shift && <button onClick={() => { loadMe(); setShowClose(true); }} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600">Close Shift</button>}
          <button onClick={onLogout} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 flex items-center gap-1"><LogOut size={14} /> Logout</button>
        </div>
      </header>

      {!ctx.shift ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
            <h2 className="font-black text-slate-900">Open Shift</h2>
            <p className="text-xs text-slate-500">Enter the cash in the drawer at the start of your shift.</p>
            <input type="number" min="0" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="Opening cash (₹)" className="w-full px-4 py-3 rounded-xl border border-slate-200 font-semibold outline-none focus:border-slate-900" />
            <button onClick={openShift} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Start Billing</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-3 p-3 min-h-0">
          {/* Products */}
          <section className="bg-white rounded-2xl shadow-sm p-3 flex flex-col min-h-[50vh] lg:min-h-0">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef} autoFocus value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSearchEnter(); }}
                placeholder="Scan barcode / type product name or SKU (Enter to add)"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 font-semibold outline-none focus:border-slate-900"
              />
              {searching && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 overflow-y-auto">
              {results.map((p) =>
                (p.variants || []).length ? (
                  p.variants.map((v) => (
                    <button key={`${p._id}-${v.sku}`} onClick={() => addToCart(p, v)} disabled={v.stock <= 0}
                      className="text-left p-3 rounded-xl border border-slate-200 hover:border-slate-900 disabled:opacity-40">
                      <p className="text-xs font-bold text-slate-900 line-clamp-2">{p.name}</p>
                      <p className="text-[11px] text-slate-500">{v.name || v.sku}</p>
                      <p className="text-sm font-black mt-1">{inr(v.unitPrice)}</p>
                      <p className={`text-[10px] font-bold ${v.stock > 0 ? "text-emerald-600" : "text-rose-600"}`}>{v.stock > 0 ? `${v.stock} in stock` : "Out of stock"}</p>
                    </button>
                  ))
                ) : (
                  <button key={p._id} onClick={() => addToCart(p)} disabled={p.stock <= 0}
                    className="text-left p-3 rounded-xl border border-slate-200 hover:border-slate-900 disabled:opacity-40">
                    <p className="text-xs font-bold text-slate-900 line-clamp-2">{p.name}</p>
                    {p.sku && <p className="text-[10px] text-slate-400">{p.sku}</p>}
                    <p className="text-sm font-black mt-1">{inr(p.unitPrice)}</p>
                    <p className={`text-[10px] font-bold ${p.stock > 0 ? "text-emerald-600" : "text-rose-600"}`}>{p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}</p>
                  </button>
                ),
              )}
              {!searching && !results.length && <p className="col-span-full text-center text-sm text-slate-400 py-10">No products found</p>}
            </div>
          </section>

          {/* Cart */}
          <section className="bg-white rounded-2xl shadow-sm p-3 flex flex-col">
            <h2 className="font-black text-slate-900 mb-2">Current Bill</h2>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px]">
              {cart.map((l) => (
                <div key={l.key} className="flex items-center gap-2 p-2 rounded-xl bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{l.name}{l.variantName ? ` (${l.variantName})` : ""}</p>
                    <p className="text-[11px] text-slate-500">{inr(l.unitPrice)} × {l.quantity} = <b>{inr(l.unitPrice * l.quantity)}</b></p>
                  </div>
                  <button onClick={() => setQty(l.key, l.quantity - 1)} className="p-1.5 rounded-lg bg-white border"><Minus size={12} /></button>
                  <input value={l.quantity} onChange={(e) => setQty(l.key, e.target.value)} className="w-10 text-center text-sm font-bold border rounded-lg py-1" inputMode="numeric" />
                  <button onClick={() => setQty(l.key, l.quantity + 1)} className="p-1.5 rounded-lg bg-white border"><Plus size={12} /></button>
                  <button onClick={() => setQty(l.key, 0)} className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 size={14} /></button>
                </div>
              ))}
              {!cart.length && <p className="text-center text-sm text-slate-400 py-8">Scan or tap products to add</p>}
            </div>

            <div className="border-t border-slate-100 pt-3 mt-2 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><b>{inr(subtotal)}</b></div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-500">Discount (₹)</span>
                <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-28 text-right px-2 py-1 border rounded-lg font-semibold" placeholder="0" />
              </div>
              <div className="flex justify-between text-lg font-black"><span>Total</span><span>{inr(total)}</span></div>
              <div className="grid grid-cols-2 gap-2">
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name (optional)" className="px-3 py-2 border rounded-lg text-xs" />
                <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Customer phone" inputMode="numeric" className="px-3 py-2 border rounded-lg text-xs" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[["cash", "Cash", Banknote], ["upi", "UPI", Smartphone], ["card", "Card", CreditCard]].map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setPaymentMode(id)}
                    className={`py-2 rounded-xl border-2 text-xs font-bold flex items-center justify-center gap-1 ${paymentMode === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200"}`}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              {paymentMode === "cash" && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500">Cash received</span>
                  <input type="number" min="0" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder={String(total)} className="w-28 text-right px-2 py-1 border rounded-lg font-semibold" />
                </div>
              )}
              {paymentMode === "cash" && cashReceived !== "" && (
                <div className={`flex justify-between text-sm font-bold ${change < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                  <span>{change < 0 ? "Short by" : "Return change"}</span><span>{inr(Math.abs(change))}</span>
                </div>
              )}
              <button onClick={completeBill} disabled={saving || !cart.length}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black disabled:opacity-50">
                {saving ? "Saving..." : `Complete Bill • ${inr(total)} (F2)`}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Receipt */}
      <Modal open={!!receiptBill} onClose={() => setReceiptBill(null)} title={`Bill ${receiptBill?.billNumber || ""}`}>
        <div id="pos-receipt-print" className="border rounded-lg p-3">
          <PosReceipt bill={receiptBill} shop={ctx.shop} counterName={ctx.counter.name} staffName={ctx.staff.name} />
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => window.print()} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center gap-1"><Printer size={16} /> Print</button>
          <button autoFocus onClick={() => { setReceiptBill(null); resetBill(); loadMe(); }} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm">New Bill</button>
        </div>
      </Modal>

      {/* Close shift */}
      <Modal open={showClose} onClose={() => setShowClose(false)} title="Close Shift">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span>Opening cash</span><b>{inr(ctx.shift?.openingCash)}</b></div>
          <div className="flex justify-between"><span>Cash sales</span><b>{inr(ctx.shift?.totals?.cash)}</b></div>
          <div className="flex justify-between"><span>UPI sales</span><b>{inr(ctx.shift?.totals?.upi)}</b></div>
          <div className="flex justify-between"><span>Card sales</span><b>{inr(ctx.shift?.totals?.card)}</b></div>
          <div className="flex justify-between border-t pt-2"><span>Expected cash in drawer</span><b>{inr(ctx.shift?.expectedCash)}</b></div>
          <input type="number" min="0" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} placeholder="Cash counted in drawer (₹)" className="w-full px-3 py-2.5 border rounded-xl font-semibold" />
          <input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Note (optional)" className="w-full px-3 py-2.5 border rounded-xl" />
          <button onClick={closeShift} className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold">Close Shift</button>
        </div>
      </Modal>

      {/* Shift closed summary */}
      <Modal open={!!closedShift} onClose={() => setClosedShift(null)} title="Shift Closed">
        {closedShift && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Bills</span><b>{closedShift.totals?.billCount}</b></div>
            <div className="flex justify-between"><span>Total sales</span><b>{inr(closedShift.totals?.grandTotal)}</b></div>
            <div className="flex justify-between"><span>Expected cash</span><b>{inr(closedShift.expectedCash)}</b></div>
            <div className="flex justify-between"><span>Counted cash</span><b>{inr(closedShift.closingCash)}</b></div>
            <div className={`flex justify-between font-black ${closedShift.cashDifference < 0 ? "text-rose-600" : closedShift.cashDifference > 0 ? "text-amber-600" : "text-emerald-700"}`}>
              <span>{closedShift.cashDifference < 0 ? "Short" : closedShift.cashDifference > 0 ? "Excess" : "Matched"}</span><span>{inr(Math.abs(closedShift.cashDifference))}</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Today's bills */}
      <Modal open={showBills} onClose={() => setShowBills(false)} title="Today's Bills (this counter)" wide>
        <div className="space-y-2">
          {bills.map((b) => (
            <div key={b._id} className="flex items-center justify-between gap-2 p-3 rounded-xl border">
              <div className="min-w-0">
                <p className="text-sm font-bold">{b.billNumber} <span className={`ml-1 text-[10px] uppercase px-1.5 py-0.5 rounded ${b.status === "cancelled" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{b.status}</span></p>
                <p className="text-[11px] text-slate-500">{new Date(b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} • {b.paymentMode.toUpperCase()} • {b.items.length} items • {b.staff?.name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <b className="text-sm">{inr(b.total)}</b>
                <button onClick={() => { setShowBills(false); setReceiptBill(b); }} className="p-2 rounded-lg border" title="Reprint"><Printer size={14} /></button>
                {ctx.staff.role === "manager" && b.status === "completed" && (
                  <button onClick={() => cancelBill(b)} className="p-2 rounded-lg border text-rose-600" title="Cancel bill"><X size={14} /></button>
                )}
              </div>
            </div>
          ))}
          {!bills.length && <p className="text-center text-sm text-slate-400 py-6">No bills today</p>}
        </div>
      </Modal>
    </div>
  );
};

/* ---------------- App ---------------- */
const PosApp = () => {
  const [token, setToken] = useState(getPosToken());
  const logout = useCallback(() => { setPosToken(""); setToken(""); }, []);
  return (
    <>
      {token ? <PosBilling key={token} onLogout={logout} /> : <PosLogin onLoggedIn={() => setToken(getPosToken())} />}
    </>
  );
};

export default PosApp;
