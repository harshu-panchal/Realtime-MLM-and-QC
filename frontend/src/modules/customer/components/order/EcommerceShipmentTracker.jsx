import React, { useState } from "react";
import { motion } from "framer-motion";
import { Truck, CheckCircle, MapPin } from "lucide-react";
import { toast } from "sonner";
import { customerApi } from "../../services/customerApi";

const STEPS = [
  { key: "SELLER_ACCEPTED", label: "Preparing" },
  { key: "SHIPMENT_CREATED", label: "Shipment created" },
  { key: "PICKUP_SCHEDULED", label: "Pickup scheduled" },
  { key: "SHIPPED", label: "Shipped" },
  { key: "IN_TRANSIT", label: "In transit" },
  { key: "OUT_FOR_DELIVERY_COURIER", label: "Out for delivery" },
  { key: "DELIVERED", label: "Delivered" },
];

function stepIndexFor(workflowStatus) {
  if (workflowStatus === "DELIVERED_PENDING_CONFIRMATION") {
    return STEPS.findIndex((s) => s.key === "OUT_FOR_DELIVERY_COURIER");
  }
  const idx = STEPS.findIndex((s) => s.key === workflowStatus);
  return idx === -1 ? 0 : idx;
}

// Quick tab (hyperlocal) orders show the rider-map/OTP UI; E-commerce orders
// show this shipment timeline instead — no live GPS or proximity handoff is
// possible for a nationwide courier shipment.
const EcommerceShipmentTracker = ({ order, onOrderUpdate }) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const activeIndex = stepIndexFor(order.workflowStatus);
  const shipment = order.shipment || {};
  const awaitingConfirmation = order.workflowStatus === "DELIVERED_PENDING_CONFIRMATION";
  const isRto = order.workflowStatus === "RTO";

  const handleConfirmReceipt = async () => {
    setIsConfirming(true);
    try {
      const response = await customerApi.confirmOrderReceived(order.orderId);
      const updated = response?.data?.result;
      if (updated) onOrderUpdate?.((prev) => ({ ...prev, ...updated }));
      toast.success("Thanks for confirming!");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to confirm delivery");
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <Truck size={20} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">
            {isRto ? "Returned to origin" : "Shipment Tracking"}
          </p>
          {shipment.awbCode && (
            <p className="text-xs text-slate-500 font-medium">
              AWB {shipment.awbCode}
              {shipment.courierName ? ` · ${shipment.courierName}` : ""}
            </p>
          )}
        </div>
      </div>

      {!isRto && (
        <div className="flex items-center">
          {STEPS.map((step, index) => (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <div
                  className={`h-3 w-3 rounded-full ${
                    index <= activeIndex ? "bg-brand-500" : "bg-slate-200"
                  }`}
                />
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide text-center leading-tight ${
                    index <= activeIndex ? "text-slate-700" : "text-slate-300"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 -mt-4 ${
                    index < activeIndex ? "bg-brand-500" : "bg-slate-200"
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {Array.isArray(shipment.trackingHistory) && shipment.trackingHistory.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          {shipment.trackingHistory
            .slice()
            .reverse()
            .slice(0, 5)
            .map((event, i) => (
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

      {awaitingConfirmation && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={handleConfirmReceipt}
          disabled={isConfirming}
          className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white rounded-2xl py-3 text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-60"
        >
          <CheckCircle size={18} />
          {isConfirming ? "Confirming..." : "Mark as Received"}
        </motion.button>
      )}
    </div>
  );
};

export default EcommerceShipmentTracker;
