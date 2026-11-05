import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
      index: true,
    },

    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: [true, "Store reference is required"],
      index: true,
    },

    batchNumber: {
      type: String,
      trim: true,
      required: [true, "Batch number is required"],
    },

    expiryDate: {
      type: Date,
      default: null,
    },

    manufacturingDate: {
      type: Date,
      default: null,
    },

    quantity: {
      type: Number,
      required: true,
      min: [0, "Quantity cannot be negative"],
      default: 0,
    },

    buyingPrice: {
      type: Number,
      required: true,
      min: [0, "Buying price cannot be negative"],
      default: 0,
    },

    sellingPrice: {
      type: Number,
      required: true,
      min: [0, "Selling price cannot be negative"],
      default: 0,
    },

    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  }
);

// Auto-archive when quantity drops to zero
batchSchema.pre("save", function () {
  if (this.quantity === 0 && !this.isArchived) {
    this.isArchived = true;
  }
  // If stock is added back (e.g. correction), un-archive
  if (this.quantity > 0 && this.isArchived) {
    this.isArchived = false;
  }
});

// Unique batch number per product
batchSchema.index({ productId: 1, batchNumber: 1 }, { unique: true });
// Efficient batch retrieval by product + archived status
batchSchema.index({ productId: 1, isArchived: 1 });
// Store-level batch queries
batchSchema.index({ store: 1, isArchived: 1 });
// Expiry date for expiry-based reports
batchSchema.index({ expiryDate: 1 });
// Composite for billing (product + store + not archived, sorted by expiry)
batchSchema.index({ store: 1, productId: 1, isArchived: 1, expiryDate: 1 });

const Batch = mongoose.model("Batch", batchSchema);

export default Batch;
