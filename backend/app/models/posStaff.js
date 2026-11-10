import mongoose from "mongoose";

/**
 * POS cashier / manager created by a seller. Logs in to the POS web panel
 * with phone + PIN. `manager` can also cancel bills.
 */
const posStaffSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Login id — unique across the platform so login needs only phone + PIN.
    phone: { type: String, required: true, trim: true, unique: true },
    pinHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["cashier", "manager"], default: "cashier" },
    counter: { type: mongoose.Schema.Types.ObjectId, ref: "PosCounter", required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export default mongoose.model("PosStaff", posStaffSchema);
