import mongoose from "mongoose";

/**
 * Cashier shift on a counter. Opening cash at start; at close the system
 * computes expected cash (opening + cash sales) and the difference with the
 * cash actually counted.
 */
const posShiftSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    counter: { type: mongoose.Schema.Types.ObjectId, ref: "PosCounter", required: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "PosStaff", required: true },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    openingCash: { type: Number, default: 0, min: 0 },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date },
    // Filled on close
    totals: {
      billCount: { type: Number, default: 0 },
      cash: { type: Number, default: 0 },
      upi: { type: Number, default: 0 },
      card: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
    },
    expectedCash: { type: Number, default: 0 },
    closingCash: { type: Number, default: 0 },
    cashDifference: { type: Number, default: 0 },
    closingNote: { type: String, trim: true },
  },
  { timestamps: true },
);

// Only one open shift per counter at a time.
posShiftSchema.index(
  { counter: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);

export default mongoose.model("PosShift", posShiftSchema);
