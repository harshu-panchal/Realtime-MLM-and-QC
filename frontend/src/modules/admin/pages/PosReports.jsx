import React, { useEffect, useState } from "react";
import axiosInstance from "@core/api/axios";
import { useToast } from "@shared/components/ui/Toast";
import { Calculator, Eye, RefreshCw, X } from "lucide-react";
import PosReceipt from "../../pos/components/PosReceipt";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStartStr = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const errMsg = (e, d) => e?.response?.data?.message || (e?.response?.status ? `${d} (error ${e.response.status})` : d);
const card = "bg-white rounded-2xl border border-slate-100 shadow-sm p-4";
const input = "h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold outline-none focus:border-slate-900 bg-white";

/** Admin: read-only POS (counter billing) report across all sellers. */
const PosReports = () => {
  const { showToast } = useToast();
  const [tab, setTab] = useState("Overview");
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [sellerId, setSellerId] = useState("");
  const [sellers, setSellers] = useState([]);
  const [report, setReport] = useState(null);
  const [bills, setBills] = useState({ items: [], page: 1, totalPages: 1, total: 0 });
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewBill, setViewBill] = useState(null);

  const params = () => ({
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59.999`).toISOString(),
    sellerId: sellerId || undefined,
  });

  const loadReport = async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get("/pos/admin/report", { params: params() });
      setReport(res.data.result);
    } catch (err) {
      showToast(errMsg(err, "Failed to load POS report"), "error");
    } finally {
      setLoading(false);
    }
  };
  const loadBills = async (page = 1) => {
    setLoading(true);
    try {
      const res = await axiosInstance.get("/pos/admin/bills", { params: { ...params(), status: status || undefined, page, limit: 20 } });
      setBills(res.data.result);
    } catch (err) {
      showToast(errMsg(err, "Failed to load POS bills"), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    axiosInstance
      .get("/pos/admin/sellers")
      .then((res) => setSellers(res.data.results || res.data.result || []))
      .catch(() => {});
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => (tab === "Overview" ? loadReport() : loadBills(1));
  useEffect(() => {
    if (tab === "Bills") loadBills(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-5 font-['Outfit',_sans-serif]">
      {/* Header + filters */}
      <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-xl bg-emerald-100 text-emerald-600"><Calculator size={22} /></span>
          <div>
            <h1 className="text-xl font-black text-slate-900">POS Reports</h1>
            <p className="text-xs text-slate-500 font-medium">In-store counter sales of all sellers (read-only). POS sales are not part of MLM.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-bold text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} block`} /></label>
          <label className="text-[11px] font-bold text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} block`} /></label>
          <label className="text-[11px] font-bold text-slate-500">Seller
            <select value={sellerId} onChange={(e) => setSellerId(e.target.value)} className={`${input} block min-w-[180px]`}>
              <option value="">All sellers</option>
              {sellers.map((s) => <option key={s._id} value={s._id}>{s.shopName || s.name}</option>)}
            </select>
          </label>
          {tab === "Bills" && (
            <label className="text-[11px] font-bold text-slate-500">Status
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${input} block`}>
                <option value="">All</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          )}
          <button onClick={apply} disabled={loading} className="h-10 px-4 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-60">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Apply
          </button>
        </div>
        <div className="flex gap-2">
          {["Overview", "Bills"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-xl text-sm font-bold ${tab === t ? "bg-slate-900 text-white" : "bg-slate-50 border border-slate-200 text-slate-600"}`}>{t}</button>
          ))}
        </div>
      </div>

      {tab === "Overview" && report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ["POS Sales", inr(report.salesTotal), `${report.billCount} bills`],
              ["Commission", inr(report.commissionTotal), "As per POS commission %"],
              ["Cancelled", report.cancelledCount, inr(report.cancelledTotal)],
              ["Discount Given", inr(report.discountTotal), "On completed bills"],
              ["Sellers using POS", report.sellersUsingPos, "Have at least one counter"],
              ["Counters", report.counterCount, sellerId ? "For this seller" : "All sellers"],
              ["Cashiers / Staff", report.staffCount, sellerId ? "For this seller" : "All sellers"],
              ["Open Shifts", report.openShifts, "Billing right now"],
            ].map(([label, value, sub]) => (
              <div key={label} className={card}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className={card}>
              <h3 className="font-black text-slate-900 mb-3">Seller-wise POS Sales</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-slate-400 border-b">
                      <th className="py-2">Shop</th><th>Owner</th><th className="text-right">Bills</th><th className="text-right">Sales</th><th className="text-right">Commission</th><th className="text-right">Cancelled</th><th className="text-right">Last bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.bySeller.map((r) => (
                      <tr key={r.sellerId} className="border-b border-slate-50">
                        <td className="py-2 font-bold">{r.shopName}</td>
                        <td className="text-xs text-slate-500">{r.ownerName}{r.phone ? ` • ${r.phone}` : ""}</td>
                        <td className="text-right">{r.billCount}</td>
                        <td className="text-right font-bold">{inr(r.salesTotal)}</td>
                        <td className="text-right">{inr(r.commission)}</td>
                        <td className="text-right">{r.cancelledCount}</td>
                        <td className="text-right text-xs">{r.lastBillAt ? new Date(r.lastBillAt).toLocaleDateString("en-IN") : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!report.bySeller.length && <p className="text-center text-sm text-slate-400 py-6">No POS sales in this period</p>}
              </div>
            </div>
            <div className={card}>
              <h3 className="font-black text-slate-900 mb-3">By Payment Mode</h3>
              {report.byPayment.map((r) => (
                <div key={r.mode} className="flex justify-between text-sm py-1.5 border-b border-slate-50">
                  <span className="uppercase font-semibold">{r.mode} <span className="text-xs text-slate-400 normal-case">• {r.count} bills</span></span>
                  <b>{inr(r.total)}</b>
                </div>
              ))}
              {!report.byPayment.length && <p className="text-sm text-slate-400">No data</p>}
            </div>
          </div>
        </>
      )}

      {tab === "Bills" && (
        <div className={card}>
          <p className="text-xs text-slate-400 mb-2">{bills.total} bills</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-slate-400 border-b">
                  <th className="py-2">Bill</th><th>Shop</th><th>Counter</th><th>Cashier</th><th>Time</th><th>Payment</th><th className="text-right">Total</th><th className="text-right">View</th>
                </tr>
              </thead>
              <tbody>
                {bills.items.map((b) => (
                  <tr key={b._id} className="border-b border-slate-50">
                    <td className="py-2 font-bold">{b.billNumber} {b.status === "cancelled" && <span className="text-[10px] uppercase text-rose-600">cancelled</span>}</td>
                    <td className="text-xs">{b.seller?.shopName || b.seller?.name}</td>
                    <td className="text-xs">{b.counter?.name}</td>
                    <td className="text-xs">{b.staff?.name}</td>
                    <td className="text-xs">{new Date(b.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="text-xs uppercase">{b.paymentMode}</td>
                    <td className="text-right font-bold">{inr(b.total)}</td>
                    <td className="text-right"><button onClick={() => setViewBill(b)} className="p-1.5 rounded-lg border" title="View bill"><Eye size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!bills.items.length && <p className="text-center text-sm text-slate-400 py-6">No bills found</p>}
          </div>
          {bills.totalPages > 1 && (
            <div className="flex justify-end items-center gap-2 mt-3">
              <button disabled={bills.page <= 1} onClick={() => loadBills(bills.page - 1)} className="px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40">Prev</button>
              <span className="text-xs font-bold">Page {bills.page} / {bills.totalPages}</span>
              <button disabled={bills.page >= bills.totalPages} onClick={() => loadBills(bills.page + 1)} className="px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40">Next</button>
            </div>
          )}
        </div>
      )}

      {viewBill && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-sm bg-white rounded-2xl p-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black">Bill {viewBill.billNumber}</h3>
              <button onClick={() => setViewBill(null)} className="p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="border rounded-lg p-3">
              <PosReceipt bill={viewBill} shop={{ shopName: viewBill.seller?.shopName || viewBill.seller?.name, phone: viewBill.seller?.phone }} />
            </div>
            {viewBill.status === "cancelled" && (
              <p className="text-xs text-rose-600 mt-2">Cancelled: {viewBill.cancelReason} ({viewBill.cancelledBy})</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PosReports;
