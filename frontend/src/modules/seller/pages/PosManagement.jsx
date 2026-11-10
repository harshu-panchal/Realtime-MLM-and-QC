import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Plus, Printer, X } from "lucide-react";
import { posSellerApi } from "../../pos/services/posApi";
import PosReceipt, { PosPrintStyles } from "../../pos/components/PosReceipt";
import { useAuth } from "@core/context/AuthContext";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
// Show the real reason (server message, HTTP status or network error) instead of a generic text.
const errMsg = (e, d) => {
  const serverMsg = e?.response?.data?.message;
  if (serverMsg) return serverMsg;
  const status = e?.response?.status;
  if (status) return `${d} (error ${status})`;
  if (e?.message) return `${d} (${e.message})`;
  return d;
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const TABS = ["Counters", "Staff", "Bills", "Report", "Shifts"];
const card = "bg-white rounded-2xl border border-slate-100 shadow-sm p-4";
const input = "px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-900";

const PosManagement = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState("Counters");
  const [counters, setCounters] = useState([]);
  const [staff, setStaff] = useState([]);
  const [counterForm, setCounterForm] = useState({ name: "", code: "" });
  const [staffForm, setStaffForm] = useState({ name: "", phone: "", pin: "", role: "cashier", counter: "" });
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [billCounter, setBillCounter] = useState("");
  const [bills, setBills] = useState({ items: [], totalPages: 1, page: 1 });
  const [report, setReport] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [printBill, setPrintBill] = useState(null);

  const range = () => ({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() });

  const loadBase = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([posSellerApi.listCounters(), posSellerApi.listStaff()]);
      setCounters(c.data.results || c.data.result || []);
      setStaff(s.data.results || s.data.result || []);
    } catch (err) { toast.error(errMsg(err, "Failed to load POS setup")); }
  }, []);
  useEffect(() => { loadBase(); }, [loadBase]);

  const loadBills = async (page = 1) => {
    try {
      const res = await posSellerApi.listBills({ ...range(), counterId: billCounter || undefined, page, limit: 20 });
      setBills(res.data.result);
    } catch (err) { toast.error(errMsg(err, "Failed to load bills")); }
  };
  const loadReport = async () => {
    try { setReport((await posSellerApi.report(range())).data.result); } catch (err) { toast.error(errMsg(err, "Failed to load report")); }
  };
  const loadShifts = async () => {
    try { setShifts((await posSellerApi.listShifts()).data.results || []); } catch (err) { toast.error(errMsg(err, "Failed to load shifts")); }
  };
  useEffect(() => {
    if (tab === "Bills") loadBills(1);
    if (tab === "Report") loadReport();
    if (tab === "Shifts") loadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const addCounter = async (e) => {
    e.preventDefault();
    try {
      await posSellerApi.createCounter(counterForm);
      toast.success("Counter added");
      setCounterForm({ name: "", code: "" });
      loadBase();
    } catch (err) { toast.error(errMsg(err, "Could not add counter")); }
  };
  const toggleCounter = async (c) => {
    try { await posSellerApi.updateCounter(c._id, { isActive: !c.isActive }); loadBase(); } catch (err) { toast.error(errMsg(err, "Failed")); }
  };
  const addStaff = async (e) => {
    e.preventDefault();
    try {
      await posSellerApi.createStaff(staffForm);
      toast.success("Staff added. They can log in at /pos with mobile + PIN.");
      setStaffForm({ name: "", phone: "", pin: "", role: "cashier", counter: "" });
      loadBase();
    } catch (err) { toast.error(errMsg(err, "Could not add staff")); }
  };
  const updateStaff = async (s, data, msg) => {
    try { await posSellerApi.updateStaff(s._id, data); if (msg) toast.success(msg); loadBase(); } catch (err) { toast.error(errMsg(err, "Failed")); }
  };
  const resetPin = (s) => {
    const pin = window.prompt(`New 4-6 digit PIN for ${s.name}:`);
    if (pin) updateStaff(s, { pin }, "PIN updated");
  };
  const cancelBill = async (b) => {
    const reason = window.prompt(`Cancel bill ${b.billNumber}? Enter reason:`);
    if (reason === null) return;
    try { await posSellerApi.cancelBill(b._id, reason); toast.success("Bill cancelled, stock returned"); loadBills(bills.page); } catch (err) { toast.error(errMsg(err, "Failed")); }
  };

  // Plain render function (not a component) so inputs keep focus across re-renders.
  const dateFilters = (onApply, children = null) => (
    <div className="flex flex-wrap items-end gap-2 mb-3">
      <label className="text-xs font-bold text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} block`} /></label>
      <label className="text-xs font-bold text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} block`} /></label>
      {children}
      <button onClick={onApply} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">Apply</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PosPrintStyles />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">POS Billing</h1>
          <p className="text-sm text-slate-500">Counters, cashiers and in-store bills. Stock is shared with your online store.</p>
        </div>
        <a href="/pos" target="_blank" rel="noreferrer" className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2">
          Open POS Panel <ExternalLink size={16} />
        </a>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap ${tab === t ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>{t}</button>
        ))}
      </div>

      {tab === "Counters" && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <form onSubmit={addCounter} className={`${card} space-y-2 h-fit`}>
            <h3 className="font-black">Add Counter</h3>
            <input value={counterForm.name} onChange={(e) => setCounterForm({ ...counterForm, name: e.target.value })} placeholder="Name (e.g. Counter 1)" className={`${input} w-full`} />
            <input value={counterForm.code} onChange={(e) => setCounterForm({ ...counterForm, code: e.target.value.toUpperCase() })} placeholder="Code for bill no. (e.g. C1) — optional" maxLength={6} className={`${input} w-full`} />
            <button className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center justify-center gap-1"><Plus size={16} /> Add Counter</button>
          </form>
          <div className={card}>
            <h3 className="font-black mb-2">Counters ({counters.length})</h3>
            <div className="space-y-2">
              {counters.map((c) => (
                <div key={c._id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                  <div><p className="font-bold text-sm">{c.name} <span className="text-xs text-slate-400">({c.code})</span></p><p className="text-[11px] text-slate-500">{c.billSeq} bills</p></div>
                  <button onClick={() => toggleCounter(c)} className={`text-xs font-bold px-3 py-1.5 rounded-lg ${c.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{c.isActive ? "Active" : "Disabled"}</button>
                </div>
              ))}
              {!counters.length && <p className="text-sm text-slate-400">No counters yet. Add your first counter.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "Staff" && (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <form onSubmit={addStaff} className={`${card} space-y-2 h-fit`}>
            <h3 className="font-black">Add Cashier / Manager</h3>
            <input value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} placeholder="Full name" className={`${input} w-full`} />
            <input value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="Mobile (login id)" inputMode="numeric" className={`${input} w-full`} />
            <input value={staffForm.pin} onChange={(e) => setStaffForm({ ...staffForm, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="PIN (4-6 digits)" inputMode="numeric" className={`${input} w-full`} />
            <div className="flex gap-2">
              <select value={staffForm.counter} onChange={(e) => setStaffForm({ ...staffForm, counter: e.target.value })} className={`${input} flex-1`}>
                <option value="">Select counter</option>
                {counters.filter((c) => c.isActive).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
              <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} className={input}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-400">Manager can also cancel bills at the counter.</p>
            <button className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center justify-center gap-1"><Plus size={16} /> Add Staff</button>
          </form>
          <div className={card}>
            <h3 className="font-black mb-2">Staff ({staff.length})</h3>
            <div className="space-y-2">
              {staff.map((s) => (
                <div key={s._id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50">
                  <div className="min-w-0">
                    <p className="font-bold text-sm">{s.name} <span className="text-[10px] uppercase text-slate-400">{s.role}</span></p>
                    <p className="text-[11px] text-slate-500">{s.phone}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={s.counter?._id || ""} onChange={(e) => updateStaff(s, { counter: e.target.value }, "Counter changed")} className={`${input} py-1.5 text-xs`}>
                      {counters.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    <button onClick={() => resetPin(s)} className="text-xs font-bold px-3 py-1.5 rounded-lg border">Reset PIN</button>
                    <button onClick={() => updateStaff(s, { isActive: !s.isActive })} className={`text-xs font-bold px-3 py-1.5 rounded-lg ${s.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{s.isActive ? "Active" : "Disabled"}</button>
                  </div>
                </div>
              ))}
              {!staff.length && <p className="text-sm text-slate-400">No staff yet. Add a counter first, then staff.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "Bills" && (
        <div className={card}>
          {dateFilters(() => loadBills(1), (
            <label className="text-xs font-bold text-slate-500">Counter
              <select value={billCounter} onChange={(e) => setBillCounter(e.target.value)} className={`${input} block`}>
                <option value="">All counters</option>
                {counters.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </label>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-xs text-slate-400 border-b"><th className="py-2">Bill</th><th>Time</th><th>Counter</th><th>Cashier</th><th>Payment</th><th className="text-right">Total</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {bills.items.map((b) => (
                  <tr key={b._id} className="border-b border-slate-50">
                    <td className="py-2 font-bold">{b.billNumber} {b.status === "cancelled" && <span className="text-[10px] text-rose-600 uppercase">cancelled</span>}</td>
                    <td className="text-xs">{new Date(b.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="text-xs">{b.counter?.name}</td>
                    <td className="text-xs">{b.staff?.name}</td>
                    <td className="text-xs uppercase">{b.paymentMode}</td>
                    <td className="text-right font-bold">{inr(b.total)}</td>
                    <td className="text-right">
                      <button onClick={() => setPrintBill(b)} className="p-1.5 rounded-lg border mr-1" title="View / print"><Printer size={14} /></button>
                      {b.status === "completed" && <button onClick={() => cancelBill(b)} className="p-1.5 rounded-lg border text-rose-600" title="Cancel"><X size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!bills.items.length && <p className="text-center text-sm text-slate-400 py-6">No bills in this period</p>}
          </div>
          {bills.totalPages > 1 && (
            <div className="flex justify-end gap-2 mt-3">
              <button disabled={bills.page <= 1} onClick={() => loadBills(bills.page - 1)} className="px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40">Prev</button>
              <span className="text-xs font-bold self-center">Page {bills.page} / {bills.totalPages}</span>
              <button disabled={bills.page >= bills.totalPages} onClick={() => loadBills(bills.page + 1)} className="px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40">Next</button>
            </div>
          )}
        </div>
      )}

      {tab === "Report" && (
        <div className="space-y-4">
          <div className={card}>{dateFilters(loadReport)}</div>
          {report && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[["Sales", inr(report.salesTotal)], ["Bills", report.billCount], ["Discount given", inr(report.discountTotal)], ["Cancelled", `${report.cancelledCount} (${inr(report.cancelledTotal)})`]].map(([l, v]) => (
                  <div key={l} className={card}><p className="text-xs font-bold text-slate-400 uppercase">{l}</p><p className="text-xl font-black mt-1">{v}</p></div>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                {[["By payment", report.byPayment.map((r) => [r.mode.toUpperCase(), r.count, r.total])],
                  ["By counter", report.byCounter.map((r) => [`${r.name || "-"} (${r.code || ""})`, r.count, r.total])],
                  ["By cashier", report.byStaff.map((r) => [r.name || "-", r.count, r.total])]].map(([title, rows]) => (
                  <div key={title} className={card}>
                    <h3 className="font-black mb-2">{title}</h3>
                    {rows.map(([n, c, t]) => (
                      <div key={n} className="flex justify-between text-sm py-1 border-b border-slate-50"><span>{n} <span className="text-xs text-slate-400">• {c} bills</span></span><b>{inr(t)}</b></div>
                    ))}
                    {!rows.length && <p className="text-sm text-slate-400">No data</p>}
                  </div>
                ))}
              </div>
              {report.commissionTotal > 0 && <p className="text-xs text-slate-500">Platform commission on POS sales in this period: <b>{inr(report.commissionTotal)}</b></p>}
            </>
          )}
        </div>
      )}

      {tab === "Shifts" && (
        <div className={card}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-xs text-slate-400 border-b"><th className="py-2">Counter</th><th>Cashier</th><th>Opened</th><th>Closed</th><th className="text-right">Sales</th><th className="text-right">Expected cash</th><th className="text-right">Counted</th><th className="text-right">Difference</th></tr></thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s._id} className="border-b border-slate-50">
                    <td className="py-2">{s.counter?.name}</td>
                    <td>{s.staff?.name}</td>
                    <td className="text-xs">{new Date(s.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="text-xs">{s.status === "open" ? <span className="text-emerald-600 font-bold">Open</span> : new Date(s.closedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="text-right">{s.status === "open" ? "-" : inr(s.totals?.grandTotal)}</td>
                    <td className="text-right">{s.status === "open" ? "-" : inr(s.expectedCash)}</td>
                    <td className="text-right">{s.status === "open" ? "-" : inr(s.closingCash)}</td>
                    <td className={`text-right font-bold ${s.cashDifference < 0 ? "text-rose-600" : s.cashDifference > 0 ? "text-amber-600" : ""}`}>{s.status === "open" ? "-" : inr(s.cashDifference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shifts.length && <p className="text-center text-sm text-slate-400 py-6">No shifts yet</p>}
          </div>
        </div>
      )}

      {printBill && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div id="pos-receipt-print" className="border rounded-lg p-3"><PosReceipt bill={printBill} shop={{ shopName: user?.shopName || user?.name, phone: user?.phone, address: user?.address }} /></div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => window.print()} className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center justify-center gap-1"><Printer size={16} /> Print</button>
              <button onClick={() => setPrintBill(null)} className="flex-1 py-2.5 rounded-xl border text-sm font-bold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PosManagement;
