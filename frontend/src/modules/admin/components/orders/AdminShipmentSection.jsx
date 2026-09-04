import React, { useState } from "react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import { Truck, MapPin, CheckCircle } from "lucide-react";
import { adminApi } from "../../services/adminApi";
import { useToast } from "@shared/components/ui/Toast";

const WORKFLOW_LABELS = {
  SELLER_ACCEPTED: "Preparing shipment",
  SHIPMENT_CREATED: "Shipment created",
  PICKUP_SCHEDULED: "Pickup scheduled",
  SHIPPED: "Shipped",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY_COURIER: "Out for delivery",
  DELIVERED_PENDING_CONFIRMATION: "Delivered — awaiting customer confirmation",
  DELIVERED: "Delivered",
  RTO: "Returned to origin",
};

const FORCE_DELIVERABLE_STATUSES = ["DELIVERED_PENDING_CONFIRMATION", "OUT_FOR_DELIVERY_COURIER", "IN_TRANSIT"];

/**
 * Admin counterpart to the customer EcommerceShipmentTracker / seller
 * ShipmentOrders page — read-only shipment status plus the "Force Delivered"
 * override for customers who never confirm receipt themselves.
 */
const AdminShipmentSection = ({ order, onOrderUpdate }) => {
  const { showToast } = useToast();
  const [isForcing, setIsForcing] = useState(false);
  const shipment = order.shipment || {};
  const canForceDeliver = FORCE_DELIVERABLE_STATUSES.includes(order.workflowStatus);

  const handleForceDelivered = async () => {
    if (!window.confirm("Mark this order as delivered? Use this only when you've confirmed the customer received it.")) {
      return;
    }
    setIsForcing(true);
    try {
      const response = await adminApi.forceOrderDelivered(order.orderId);
      if (response.data?.result) onOrderUpdate?.((prev) => ({ ...prev, ...response.data.result }));
      showToast("Order marked as delivered", "success");
    } catch (error) {
      showToast(error.response?.data?.message || "Failed to update order", "error");
    } finally {
      setIsForcing(false);
    }
  };

  return (
    <Card className="border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-xl overflow-hidden">
      <div className="p-6 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-3">
          <Truck className="h-4 w-4 text-brand-500" />
          Shipment (E-commerce)
        </h3>
        <Badge className="bg-brand-50 text-brand-700 border-none text-[9px] font-black">
          {WORKFLOW_LABELS[order.workflowStatus] || order.workflowStatus || "Pending"}
        </Badge>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] mb-1">AWB</p>
            <p className="font-bold text-slate-800">{shipment.awbCode || "Not assigned yet"}</p>
          </div>
          <div>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] mb-1">Courier</p>
            <p className="font-bold text-slate-800">{shipment.courierName || "—"}</p>
          </div>
          <div>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] mb-1">Pickup Scheduled</p>
            <p className="font-bold text-slate-800">
              {shipment.pickupScheduledAt
                ? new Date(shipment.pickupScheduledAt).toLocaleString("en-GB")
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] mb-1">Label</p>
            {shipment.labelUrl ? (
              <a href={shipment.labelUrl} target="_blank" rel="noreferrer" className="font-bold text-brand-600 hover:underline">
                View / Print
              </a>
            ) : (
              <p className="font-bold text-slate-400">—</p>
            )}
          </div>
        </div>

        {Array.isArray(shipment.trackingHistory) && shipment.trackingHistory.length > 0 && (
          <div className="pt-3 border-t border-slate-100 space-y-2">
            {shipment.trackingHistory.slice().reverse().slice(0, 5).map((event, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <MapPin size={13} className="text-slate-300 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold text-slate-700">{event.status || event.activity}</p>
                  {event.location && <p className="text-slate-400">{event.location}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {canForceDeliver && (
          <button
            onClick={handleForceDelivered}
            disabled={isForcing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest bg-slate-900 text-white hover:bg-slate-800 transition-all disabled:opacity-60"
          >
            <CheckCircle className="h-4 w-4" />
            {isForcing ? "Updating..." : "Force Mark Delivered"}
          </button>
        )}
      </div>
    </Card>
  );
};

export default AdminShipmentSection;
