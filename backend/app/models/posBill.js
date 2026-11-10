import mongoose from "mongoose";

/**
 * POS (in-store counter) bill. Prices are taken from the Product in the DB at
 * billing time (never from the client). POS sales are NOT part of MLM and do
 * not touch the seller's online wallet — the seller collects payment at the
 * counter directly.
 */
const posBillItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true },
    variantSku: { type: String, default: "" },
    variantName: { type: String, default: "" },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const posBillSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    counter: { type: mongoose.Schema.Types.ObjectId, ref: "PosCounter", required: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "PosStaff", required: true },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: "PosShift", required: true, index: true },
    billNumber: { type: String, required: true },
    items: { type: [posBillItemSchema], validate: (v) => Array.isArray(v) && v.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMode: { type: String, enum: ["cash", "upi", "card"], required: true },
    // Cash: amount handed by customer and change returned (for the receipt)
    cashReceived: { type: Number, default: 0 },
    changeReturned: { type: Number, default: 0 },
    customerName: { type: String, trim: true, default: "" },
    customerPhone: { type: String, trim: true, default: "" },
    // Platform commission snapshot (Setting.posCommissionPercent at billing time)
    commissionPercent: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    status: { type: String, enum: ["completed", "cancelled"], default: "completed" },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true },
    cancelledBy: { type: String, trim: true },
  },
  { timestamps: true },
);

posBillSchema.index({ seller: 1, billNumber: 1 }, { unique: true });
posBillSchema.index({ seller: 1, createdAt: -1 });
posBillSchema.index({ counter: 1, createdAt: -1 });

export default mongoose.model("PosBill", posBillSchema);
