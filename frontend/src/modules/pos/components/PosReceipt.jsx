import React from "react";

const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Thermal-printer friendly receipt (fits 58mm/80mm). Rendered inside
 * #pos-receipt-print; the print CSS below hides everything else.
 */
export const PosPrintStyles = () => (
  <style>{`
    @media print {
      @page { margin: 0; size: 80mm auto; }
      body * { visibility: hidden !important; }
      #pos-receipt-print, #pos-receipt-print * { visibility: visible !important; }
      #pos-receipt-print { position: absolute; left: 0; top: 0; width: 72mm; padding: 2mm; }
    }
  `}</style>
);

const PosReceipt = ({ bill, shop, counterName, staffName }) => {
  if (!bill) return null;
  const date = new Date(bill.createdAt || Date.now());
  return (
    <div className="font-mono text-[11px] leading-tight text-black bg-white">
      <div className="text-center">
        <p className="text-[14px] font-bold">{shop?.shopName || "Shop"}</p>
        {shop?.address && <p>{shop.address}</p>}
        {shop?.phone && <p>Ph: {shop.phone}</p>}
      </div>
      <div className="border-t border-dashed border-black my-1" />
      <div className="flex justify-between"><span>Bill: {bill.billNumber}</span><span>{date.toLocaleDateString("en-IN")}</span></div>
      <div className="flex justify-between"><span>{counterName || bill.counter?.name}</span><span>{date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <p>Cashier: {staffName || bill.staff?.name || "-"}</p>
      {(bill.customerName || bill.customerPhone) && (
        <p>Customer: {[bill.customerName, bill.customerPhone].filter(Boolean).join(" / ")}</p>
      )}
      <div className="border-t border-dashed border-black my-1" />
      {bill.items.map((it, i) => (
        <div key={i} className="mb-0.5">
          <p>{it.name}{it.variantName ? ` (${it.variantName})` : ""}</p>
          <div className="flex justify-between">
            <span>{it.quantity} x {inr(it.unitPrice)}</span>
            <span>{inr(it.lineTotal)}</span>
          </div>
        </div>
      ))}
      <div className="border-t border-dashed border-black my-1" />
      <div className="flex justify-between"><span>Subtotal</span><span>{inr(bill.subtotal)}</span></div>
      {bill.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>- {inr(bill.discount)}</span></div>}
      <div className="flex justify-between text-[13px] font-bold"><span>TOTAL</span><span>{inr(bill.total)}</span></div>
      <div className="flex justify-between"><span>Paid by</span><span className="uppercase">{bill.paymentMode}</span></div>
      {bill.paymentMode === "cash" && (
        <>
          <div className="flex justify-between"><span>Cash received</span><span>{inr(bill.cashReceived)}</span></div>
          <div className="flex justify-between"><span>Change</span><span>{inr(bill.changeReturned)}</span></div>
        </>
      )}
      {bill.status === "cancelled" && <p className="text-center font-bold mt-1">*** CANCELLED ***</p>}
      <div className="border-t border-dashed border-black my-1" />
      <p className="text-center">Thank you! Visit again.</p>
    </div>
  );
};

export default PosReceipt;
