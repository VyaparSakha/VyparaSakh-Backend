import mongoose from "mongoose";

const aiPricingConfigSchema = new mongoose.Schema(
  {
    featureName: {
      type: String,
      required: [true, "Feature name is required"],
      default: "default",
      trim: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      default: "default",
      trim: true,
      index: true,
    },
    model: {
      type: String,
      required: true,
      default: "default",
      trim: true,
      index: true,
    },
    // Rate in credits per 1,000 input tokens
    inputTokenCreditRate: {
      type: Number,
      required: true,
      default: 2, // e.g. 2 credits per 1,000 input tokens (placeholder dev rate)
      min: [0, "Input token credit rate cannot be negative"],
    },
    // Rate in credits per 1,000 output tokens
    outputTokenCreditRate: {
      type: Number,
      required: true,
      default: 6, // e.g. 6 credits per 1,000 output tokens (placeholder dev rate)
      min: [0, "Output token credit rate cannot be negative"],
    },
    // Rate in credits per second or unit of audio input
    audioInputRate: {
      type: Number,
      default: 1, // e.g. 1 credit per second (placeholder dev rate)
      min: [0, "Audio input rate cannot be negative"],
    },
    // Rate in credits per second or unit of audio output
    audioOutputRate: {
      type: Number,
      default: 2, // e.g. 2 credits per second (placeholder dev rate)
      min: [0, "Audio output rate cannot be negative"],
    },
    // Optional duration-based voice rate (credits per minute/call)
    voiceDurationRate: {
      type: Number,
      default: 0,
      min: [0, "Voice duration rate cannot be negative"],
    },
    minCharge: {
      type: Number,
      required: true,
      default: 1, // minimum 1 credit charge for any executed call
      min: [0, "Minimum charge cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "minCharge must be an integer",
      },
    },
    maxExecutionCharge: {
      type: Number,
      required: true,
      default: 250, // upper ceiling to protect wallets against runaway executions
      min: [1, "Maximum execution charge must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "maxExecutionCharge must be an integer",
      },
    },
    pricingVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "ai_pricing_configs",
  }
);

aiPricingConfigSchema.index({ featureName: 1, provider: 1, model: 1, isActive: 1 });

const AiPricingConfig =
  mongoose.models.AiPricingConfig ||
  mongoose.model("AiPricingConfig", aiPricingConfigSchema);

export default AiPricingConfig;

