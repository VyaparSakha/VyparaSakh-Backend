import mongoose from "mongoose";

const aiCreditTransactionSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Transaction must belong to an owner"],
      index: true,
    },
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiWallet",
      required: [true, "Transaction must reference a wallet"],
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
      default: null,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      required: [true, "Transaction type is required"],
      enum: [
        "credit_grant",
        "credit_purchase",
        "reservation",
        "usage_charge",
        "reservation_release",
        "refund",
        "adjustment",
      ],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Transaction amount cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Transaction amount must be an integer",
      },
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: [0, "Balance after cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Balance after must be an integer",
      },
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "ai_credit_transactions",
  }
);

// Compound indexes for optimal querying
aiCreditTransactionSchema.index({ ownerId: 1, createdAt: -1 });
aiCreditTransactionSchema.index({ storeId: 1, createdAt: -1 });
aiCreditTransactionSchema.index({ ownerId: 1, type: 1, createdAt: -1 });
aiCreditTransactionSchema.index({ executionId: 1, type: 1 });

// Enforce strict immutability: block updates and deletions
const blockMutation = function (next) {
  next(new Error("AiCreditTransaction records are immutable and cannot be modified or deleted."));
};

aiCreditTransactionSchema.pre("updateOne", blockMutation);
aiCreditTransactionSchema.pre("updateMany", blockMutation);
aiCreditTransactionSchema.pre("findOneAndUpdate", blockMutation);
aiCreditTransactionSchema.pre("findOneAndReplace", blockMutation);
aiCreditTransactionSchema.pre("deleteOne", blockMutation);
aiCreditTransactionSchema.pre("deleteMany", blockMutation);
aiCreditTransactionSchema.pre("findOneAndDelete", blockMutation);

const AiCreditTransaction =
  mongoose.models.AiCreditTransaction ||
  mongoose.model("AiCreditTransaction", aiCreditTransactionSchema);

export default AiCreditTransaction;

