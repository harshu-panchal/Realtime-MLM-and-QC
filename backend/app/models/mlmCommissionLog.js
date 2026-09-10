import mongoose from "mongoose";

const mlmCommissionLogSchema = new mongoose.Schema(
  {
    requestedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    creditedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    cappedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "entityType",
      index: true,
    },
    entityType: {
      type: String,
      required: true,
      enum: ["User", "Seller", "Delivery"],
    },
    treeInfo: {
      sponsorId: { type: mongoose.Schema.Types.ObjectId, ref: "MlmTree" },
      parentId: { type: mongoose.Schema.Types.ObjectId, ref: "MlmTree" },
      position: { type: String, enum: ["root", "left", "right"] },
      level: { type: Number, default: 0 },
    },
    sourceOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    remarks: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

mlmCommissionLogSchema.index({ entityId: 1, entityType: 1, date: -1 });

export default mongoose.model("MlmCommissionLog", mlmCommissionLogSchema);
