import React, { useEffect, useState } from "react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import { HiOutlineArrowsRightLeft, HiOutlineCheck, HiOutlineXMark } from "react-icons/hi2";
import { toast } from "sonner";
import { adminApi } from "../services/adminApi";

const TYPE_LABELS = {
  quick_commerce: "Quick Commerce",
  ecommerce: "E-commerce",
};

const BusinessTypeChangeRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState(null);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const response = await adminApi.getBusinessTypeChangeRequests();
      const items = response.data?.result?.items || [];
      setRequests(items);
    } catch (error) {
      toast.error("Failed to load business type change requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleDecision = async (sellerId, decision) => {
    setActioningId(sellerId);
    try {
      if (decision === "approve") {
        await adminApi.approveBusinessTypeChangeRequest(sellerId);
        toast.success("Business type change approved");
      } else {
        await adminApi.rejectBusinessTypeChangeRequest(sellerId);
        toast.success("Business type change rejected");
      }
      setRequests((prev) => prev.filter((r) => r.id !== sellerId));
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to process request");
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-2 duration-700 pb-16">
      <div>
        <h1 className="ds-h1 flex items-center gap-2">
          Business Type Requests
          <Badge variant="primary" className="text-[9px] px-1.5 py-0 font-bold tracking-wider uppercase">Admin</Badge>
        </h1>
        <p className="ds-description mt-0.5">
          Sellers requesting to switch between Quick Commerce and E-commerce.
        </p>
      </div>

      <Card className="border-none shadow-xl ring-1 ring-slate-100 overflow-hidden rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-300">
            <HiOutlineArrowsRightLeft className="h-14 w-14 mb-3 opacity-30" />
            <p className="text-base font-bold italic">No pending requests</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {requests.map((seller) => (
              <div key={seller.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">{seller.shopName}</p>
                  <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                    {seller.ownerName} &middot; {seller.email}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-widest">
                      {TYPE_LABELS[seller.businessType] || seller.businessType}
                    </Badge>
                    <HiOutlineArrowsRightLeft className="h-3.5 w-3.5 text-slate-400" />
                    <Badge variant="primary" className="text-[9px] font-bold uppercase tracking-widest">
                      {TYPE_LABELS[seller.businessTypeChangeRequest?.requestedType] ||
                        seller.businessTypeChangeRequest?.requestedType}
                    </Badge>
                  </div>
                  {seller.businessTypeChangeRequest?.reason && (
                    <p className="text-xs text-slate-500 font-medium mt-2 italic max-w-lg">
                      "{seller.businessTypeChangeRequest.reason}"
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    disabled={actioningId === seller.id}
                    onClick={() => handleDecision(seller.id, "reject")}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all disabled:opacity-50"
                  >
                    <HiOutlineXMark className="h-4 w-4" />
                    Reject
                  </button>
                  <button
                    disabled={actioningId === seller.id}
                    onClick={() => handleDecision(seller.id, "approve")}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-all disabled:opacity-50"
                  >
                    <HiOutlineCheck className="h-4 w-4" />
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default BusinessTypeChangeRequests;
