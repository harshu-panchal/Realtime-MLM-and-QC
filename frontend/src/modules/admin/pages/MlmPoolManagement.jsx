// @ts-nocheck
import React, { useEffect, useState } from "react";
import axiosInstance from "@core/api/axios";
import { 
  Users, 
  Coins, 
  Layers, 
  ArrowRight, 
  CheckCircle2, 
  Clock, 
  RefreshCw, 
  HelpCircle,
  Calendar,
  Sparkles,
  TrendingUp,
  Percent
} from "lucide-react";
import { useToast } from "@shared/components/ui/Toast";

const MlmPoolManagement = () => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [activeTab, setActiveTab] = useState("all"); // 'all', 'sectionA', 'sectionB'

  const fetchMlmOverview = async (dateStr) => {
    setLoading(true);
    try {
      const res = await axiosInstance.get(`/mlm/overview`, {
        params: { date: dateStr },
      });
      const result = res.data?.result || res.data?.data || res.data;
      setData(result);
    } catch (err) {
      console.error("Failed to fetch MLM Overview:", err);
      showToast(err.response?.data?.message || "Failed to load MLM Pool data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMlmOverview(selectedDate);
  }, [selectedDate]);

  const summary = data?.poolSummary || {
    totalCustomerSubAmount: 0,
    totalVendorFeeAmount: 0,
    totalRiderFeeAmount: 0,
    totalOrderCommissionAmount: 0,
    grandTotalInflow: 0,
    pairValue: 3.60,
    totalGeneratedPoolIds: 0,
    integerIds: 0,
  };

  const sectionA = data?.sectionA?.items || [];
  const sectionB = data?.sectionB?.items || [];

  return (
    <div className="space-y-6 font-['Outfit',_sans-serif]">
      {/* Header with Title and Date Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-100 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-orange-100 text-orange-600 font-bold">
              <Coins size={22} />
            </span>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                MLM Pool & Binary ID Generator
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Live monitoring of daily inflow pool, binary pair generation and participant queues
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-10 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
          />
          <button
            onClick={() => fetchMlmOverview(selectedDate)}
            disabled={loading}
            className="h-10 px-4 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center gap-1.5 hover:bg-slate-800 transition-all cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Top 4 KPI Cards: Inflow Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: User Weekly Subscriptions */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">User Subscriptions</span>
            <Users size={18} className="text-blue-500" />
          </div>
          <p className="text-2xl font-black text-slate-900">
            {loading ? "..." : `₹${(summary.totalCustomerSubAmount || 0).toLocaleString()}`}
          </p>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Customer Saturday fee pool</p>
        </div>

        {/* Card 2: Vendor Onboarding */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Vendor Onboarding</span>
            <TrendingUp size={18} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-slate-900">
            {loading ? "..." : `₹${(summary.totalVendorFeeAmount || 0).toLocaleString()}`}
          </p>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Seller registration collection</p>
        </div>

        {/* Card 3: Rider Subscriptions */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Rider Subscriptions</span>
            <Coins size={18} className="text-purple-500" />
          </div>
          <p className="text-2xl font-black text-slate-900">
            {loading ? "..." : `₹${(summary.totalRiderFeeAmount || 0).toLocaleString()}`}
          </p>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Delivery partner registration</p>
        </div>

        {/* Card 4: Orders MLM Commission */}
        <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Order Commission Pool</span>
            <Layers size={18} className="text-orange-500" />
          </div>
          <p className="text-2xl font-black text-slate-900">
            {loading ? "..." : `₹${(summary.totalOrderCommissionAmount || 0).toLocaleString()}`}
          </p>
          <p className="text-[11px] text-slate-400 mt-1 font-medium">Delivered order allocations</p>
        </div>
      </div>

      {/* Main Stats Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-orange-950 p-6 rounded-3xl text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full">
                Daily Pool Status
              </span>
              <span className="text-xs text-slate-400">Total Inflow: ₹{(summary.grandTotalInflow || 0).toLocaleString()}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
              <span className="text-orange-400">
                {loading ? "..." : summary.totalGeneratedPoolIds}
              </span>{" "}
              <span className="text-white text-2xl font-bold">Generated IDs Today</span>
            </h2>
            <p className="text-xs text-slate-300 mt-2 max-w-xl leading-relaxed">
              Based on today&apos;s collections. Nodes with completed pairs are credited in{" "}
              <span className="text-emerald-400 font-bold">Section B</span>, and waiting volumes remain in{" "}
              <span className="text-amber-400 font-bold">Section A</span>.
            </p>
          </div>

          <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10">
            <div className="text-center px-4 border-r border-white/10">
              <p className="text-[11px] font-bold text-slate-300 uppercase">Section A (Pending)</p>
              <p className="text-2xl font-black text-amber-400 mt-0.5">{data?.sectionA?.count || 0}</p>
            </div>
            <div className="text-center px-4">
              <p className="text-[11px] font-bold text-slate-300 uppercase">Section B (Generated)</p>
              <p className="text-2xl font-black text-emerald-400 mt-0.5">{data?.sectionB?.count || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Filter */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab("all")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === "all"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          All Sections
        </button>
        <button
          onClick={() => setActiveTab("sectionB")}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "sectionB"
              ? "bg-emerald-600 text-white"
              : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
          }`}
        >
          <CheckCircle2 size={13} />
          <span>Section B - Generated IDs ({data?.sectionB?.count || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab("sectionA")}
          className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "sectionA"
              ? "bg-amber-600 text-white"
              : "text-amber-700 bg-amber-50 hover:bg-amber-100"
          }`}
        >
          <Clock size={13} />
          <span>Section A - Pending ({data?.sectionA?.count || 0})</span>
        </button>
      </div>

      {/* SECTION B: GENERATED IDS TABLE */}
      {(activeTab === "all" || activeTab === "sectionB") && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-emerald-50/40">
            <div className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-sm">
                B
              </span>
              <div>
                <h3 className="font-black text-slate-900 text-base">
                  Section B — IDs Generated & Commission Credited
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Nodes whose pair matches occurred and commission was generated
                </p>
              </div>
            </div>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-100/80 px-3 py-1 rounded-full">
              {sectionB.length} Entries
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-400 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Participant</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Inflow Source</th>
                  <th className="py-3 px-4">Units Generated</th>
                  <th className="py-3 px-4">Credited Amount</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sectionB.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-slate-400 text-xs font-semibold">
                      No generated IDs recorded in Section B for this date yet.
                    </td>
                  </tr>
                ) : (
                  sectionB.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        <p className="text-[11px] text-slate-400">{item.phone}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {item.entityType}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-xs text-slate-600">
                        {item.source}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-black text-emerald-700 text-sm">
                          {item.generatedIds} IDs
                        </span>
                        <p className="text-[10px] text-slate-400">@ ₹{item.unitValue} each</p>
                      </td>
                      <td className="py-3.5 px-4 font-black text-slate-900">
                        ₹{(item.creditedAmount || 0).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                          <CheckCircle2 size={12} />
                          Generated
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION A: PENDING IDS TABLE */}
      {(activeTab === "all" || activeTab === "sectionA") && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50/40">
            <div className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-black text-sm">
                A
              </span>
              <div>
                <h3 className="font-black text-slate-900 text-base">
                  Section A — Pending / Waiting Balance (ID Not Yet Formed)
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Nodes waiting for Left/Right volume match to form pairs
                </p>
              </div>
            </div>
            <span className="text-xs font-bold text-amber-700 bg-amber-100/80 px-3 py-1 rounded-full">
              {sectionA.length} Waiting Nodes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-[11px] font-black uppercase text-slate-400 tracking-wider">
                <tr>
                  <th className="py-3 px-4">Participant</th>
                  <th className="py-3 px-4">Role & Level</th>
                  <th className="py-3 px-4">Left Balance</th>
                  <th className="py-3 px-4">Right Balance</th>
                  <th className="py-3 px-4">Unmatched Difference</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sectionA.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="py-8 text-center text-slate-400 text-xs font-semibold">
                      No nodes pending in Section A. All tree nodes are currently balanced!
                    </td>
                  </tr>
                ) : (
                  sectionA.map((node) => (
                    <tr key={node.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-bold text-slate-900">{node.name}</p>
                        <p className="text-[11px] text-slate-400">{node.phone}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {node.entityType} (Lvl {node.level})
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-blue-600">
                        ₹{(node.leftBalance || 0).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-purple-600">
                        ₹{(node.rightBalance || 0).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-amber-600">
                        ₹{(node.unmatchedBalance || 0).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                          <Clock size={12} />
                          Pending Match
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default MlmPoolManagement;
