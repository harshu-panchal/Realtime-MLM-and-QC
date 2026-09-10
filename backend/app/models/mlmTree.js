import mongoose from "mongoose";

const mlmTreeSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "entityModel",
    },
    entityType: {
      type: String,
      required: true,
      enum: ["User", "Seller", "Delivery"],
    },
    entityModel: {
      type: String,
      required: true,
      enum: ["User", "Seller", "Delivery"],
      default: function () {
        return this.entityType;
      },
    },
    sponsorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmTree",
      default: null,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmTree",
      default: null,
    },
    leftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmTree",
      default: null,
    },
    rightId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MlmTree",
      default: null,
    },
    position: {
      type: String,
      enum: ["root", "left", "right"],
      default: "root",
    },
    level: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

mlmTreeSchema.index({ entityId: 1, entityType: 1 }, { unique: true });
mlmTreeSchema.index({ parentId: 1, position: 1 });
mlmTreeSchema.index({ sponsorId: 1 });

export default mongoose.model("MlmTree", mlmTreeSchema);
