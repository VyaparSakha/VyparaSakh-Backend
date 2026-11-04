import mongoose from "mongoose";

const aiCreditReservationSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reservation must belong to an owner"],
      index: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiWallet",
      required: [true, "Reservation must reference a wallet"],
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
      required: [true, "Unique executionId is required for credit reservation"],
      unique: true,
      index: true,
      trim: true,
    },
    featureName: {
      type: String,
      default: "copilot",
      index: true,
      trim: true,
    },
    reservedCredits: {
      type: Number,
      required: true,
      min: [1, "Reserved credits must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "Reserved credits must be an integer",
      },
    },
    consumedCredits: {
      type: Number,
      default: 0,
      min: [0, "Consumed credits cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Consumed credits must be an integer",
      },
    },
    releasedCredits: {
      type: Number,
      default: 0,
      min: [0, "Released credits cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Released credits must be an integer",
      },
    },
    status: {
      type: String,
      enum: ["active", "settled", "released", "expired"],
      default: "active",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
      default: () => new Date(Date.now() + 5 * 60 * 1000), // Default 5 minutes TTL
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: "ai_credit_reservations",
  }
);

// Compound indexes for fast status, owner and store lookups
aiCreditReservationSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
aiCreditReservationSchema.index({ storeId: 1, createdAt: -1 });
aiCreditReservationSchema.index({ status: 1, expiresAt: 1 });

const AiCreditReservation =
  mongoose.models.AiCreditReservation ||
  mongoose.model("AiCreditReservation", aiCreditReservationSchema);

export default AiCreditReservation;

