import mongoose from "mongoose";

/**
 * POS billing counter of a seller's shop (Counter 1, Counter 2, ...).
 * `billSeq` is incremented atomically to generate per-counter bill numbers.
 */
const posCounterSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Short code used as bill-number prefix, e.g. "C1" → C1-00001
    code: { type: String, required: true, trim: true, uppercase: true },
    isActive: { type: Boolean, default: true },
    billSeq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

posCounterSchema.index({ seller: 1, code: 1 }, { unique: true });

export default mongoose.model("PosCounter", posCounterSchema);
