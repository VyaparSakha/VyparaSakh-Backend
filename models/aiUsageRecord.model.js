import mongoose from "mongoose";

const aiUsageRecordSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Usage record must have an owner"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Usage record must reference the executing user"],
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null,
      index: true,
    },
    executionId: {
      type: String,
      required: [true, "Unique executionId is required for usage record"],
      unique: true,
      index: true,
      trim: true,
    },
    feature: {
      type: String,
      default: "copilot",
      index: true,
      trim: true,
    },
    provider: {
      type: String,
      default: "default",
      trim: true,
    },
    model: {
      type: String,
      default: "default",
      trim: true,
    },
    modelBreakdown: {
      type: [
        {
          provider: String,
          model: String,
          inputTokens: { type: Number, default: 0 },
          outputTokens: { type: Number, default: 0 },
          audioInputUnits: { type: Number, default: 0 },
          audioOutputUnits: { type: Number, default: 0 },
          callCount: { type: Number, default: 1 },
          providerUsageStatus: { type: String, default: "verified" },
        },
      ],
      default: [],
    },
    inputTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    outputTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    audioInputUnits: {
      type: Number,
      default: 0,
      min: 0,
    },
    audioOutputUnits: {
      type: Number,
      default: 0,
      min: 0,
    },
    creditsCharged: {
      type: Number,
      required: true,
      min: 0,
    },
    pricingVersion: {
      type: Number,
      default: 1,
    },
    executionStatus: {
      type: String,
      enum: ["completed", "interrupted", "cancelled", "failed"],
      default: "completed",
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    settledAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "ai_usage_records",
  }
);

aiUsageRecordSchema.index({ ownerId: 1, createdAt: -1 });
aiUsageRecordSchema.index({ storeId: 1, createdAt: -1 });
aiUsageRecordSchema.index({ feature: 1, createdAt: -1 });

const AiUsageRecord =
  mongoose.models.AiUsageRecord ||
  mongoose.model("AiUsageRecord", aiUsageRecordSchema);

export default AiUsageRecord;

