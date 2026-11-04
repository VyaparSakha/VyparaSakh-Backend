import mongoose from "mongoose";

/**
 * Calculates start and end of calendar month period
 * @param {Date} [date=new Date()]
 * @returns {{ periodStart: Date, periodEnd: Date }}
 */
export const getCalendarMonthPeriod = (date = new Date()) => {
  const d = new Date(date);
  const periodStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { periodStart, periodEnd };
};

const aiWalletSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Wallet must be associated with an owner User ID"],
      unique: true,
      index: true,
    },
    // Total credits owned before subtracting any active reservations
    balance: {
      type: Number,
      required: true,
      default: 1000, // Initial free tier credit grant
      min: [0, "Wallet balance cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Wallet balance must be an integer",
      },
    },
    // Credits temporarily held for ongoing/inflight AI operations
    reservedBalance: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Reserved balance cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Reserved balance must be an integer",
      },
    },
    // Maximum credits permitted to be consumed in current calendar billing period
    monthlyLimit: {
      type: Number,
      required: true,
      default: 5000,
      min: [0, "Monthly limit cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Monthly limit must be an integer",
      },
    },
    // Credits consumed so far in current calendar billing period
    monthlyUsed: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Monthly used credits cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Monthly used credits must be an integer",
      },
    },
    periodStart: {
      type: Date,
      required: true,
      default: () => getCalendarMonthPeriod().periodStart,
    },
    periodEnd: {
      type: Date,
      required: true,
      default: () => getCalendarMonthPeriod().periodEnd,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "ai_wallets",
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Derived virtual: availableBalance = balance - reservedBalance
 * Non-editable, derived dynamically from the source of truth.
 */
aiWalletSchema.virtual("availableBalance").get(function () {
  const bal = typeof this.balance === "number" ? this.balance : 0;
  const res = typeof this.reservedBalance === "number" ? this.reservedBalance : 0;
  return Math.max(0, bal - res);
});

/**
 * Instance method to check if current billing period has elapsed
 */
aiWalletSchema.methods.isPeriodExpired = function (now = new Date()) {
  return !this.periodEnd || new Date(now) > new Date(this.periodEnd);
};

const AiWallet = mongoose.models.AiWallet || mongoose.model("AiWallet", aiWalletSchema);

export default AiWallet;

