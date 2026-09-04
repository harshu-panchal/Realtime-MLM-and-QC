import React, { useEffect, useState } from "react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import { HiOutlineTruck, HiOutlinePrinter, HiOutlineArrowPath } from "react-icons/hi2";
import { toast } from "sonner";
import { sellerApi } from "../services/sellerApi";

const WORKFLOW_LABELS = {
  SELLER_ACCEPTED: "Preparing shipment",
  SHIPMENT_CREATED: "Shipment created",
  PICKUP_SCHEDULED: "Pickup scheduled",
  SHIPPED: "Shipped",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY_COURIER: "Out for delivery",
  DELIVERED_PENDING_CONFIRMATION: "Delivered — awaiting confirmation",
  DELIVERED: "Delivered",
  RTO: "Returned to origin",
};

const WORKFLOW_BADGE_VARIANT = {
  DELIVERED: "emerald",
  DELIVERED_PENDING_CONFIRMATION: "amber",
  RTO: "rose",
};

// Visible only to E-commerce sellers (see routes/index.jsx). Shows
// post-acceptance Shiprocket fulfillment state for their orders — pickup
// scheduling, AWB/courier once assigned, label, and live tracking status.
// Accepting an order itself still happens on the regular Orders page; this
// page is read-only fulfillment visibility.
const ShipmentOrders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const response = await sellerApi.getOrders({ limit: 100 });
      const items = response.data?.result?.items || [];
      setOrders(items.filter((order) => order.businessType === "ecommerce"));
    } catch (error) {
      toast.error("Failed to load shipment orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  return (
    <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-2 duration-700 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="ds-h1">Shipments</h1>
          <p className="ds-description mt-0.5">
            Fulfillment status for your E-commerce orders (via Shiprocket).
          </p>
        </div>
        <button
          onClick={fetchOrders}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-white ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50 transition-all"
        >
          <HiOutlineArrowPath className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <Card className="border-none shadow-xl ring-1 ring-slate-100 overflow-hidden rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-300">
            <HiOutlineTruck className="h-14 w-14 mb-3 opacity-30" />
            <p className="text-base font-bold italic">No shipments yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="ds-table-header-cell px-6">Order</th>
                  <th className="ds-table-header-cell px-6">Status</th>
                  <th className="ds-table-header-cell px-6">AWB / Courier</th>
                  <th className="ds-table-header-cell px-6">Pickup</th>
                  <th className="ds-table-header-cell px-6 text-right">Label</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {orders.map((order) => (
                  <tr key={order._id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-xs font-bold text-slate-900">{order.orderId}</td>
                    <td className="px-6 py-4">
                      <Badge
                        variant={WORKFLOW_BADGE_VARIANT[order.workflowStatus] || "gray"}
                        className="text-[9px] font-black uppercase tracking-widest"
                      >
                        {WORKFLOW_LABELS[order.workflowStatus] || order.workflowStatus || "Pending"}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-600">
                      {order.shipment?.awbCode ? (
                        <>
                          {order.shipment.awbCode}
                          {order.shipment.courierName && (
                            <span className="text-slate-400"> &middot; {order.shipment.courierName}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-300">Not assigned yet</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-600">
                      {order.shipment?.pickupScheduledAt
                        ? new Date(order.shipment.pickupScheduledAt).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {order.shipment?.labelUrl ? (
                        <a
                          href={order.shipment.labelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                        >
                          <HiOutlinePrinter className="h-4 w-4" />
                          Print Label
                        </a>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ShipmentOrders;
