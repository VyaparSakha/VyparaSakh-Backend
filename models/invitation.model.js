import mongoose from "mongoose";

const invitationSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: [true, "Store is required"],
      index: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      index: true,
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: [true, "Role is required"],
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "InvitedBy is required"],
    },
    tokenHash: {
      type: String,
      required: [true, "Token hash is required"],
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "expired", "revoked"],
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      required: [true, "Expires at is required"],
      index: true,
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index: fast lookup of invites by store and email
invitationSchema.index({ store: 1, email: 1 });

// Fast lookup of pending invites per store
invitationSchema.index({ store: 1, status: 1 });

// Helper to check expiration
invitationSchema.methods.isExpired = function () {
  return this.status === "expired" || (this.expiresAt && new Date() > this.expiresAt);
};

// Helper to check if pending & valid
invitationSchema.methods.isPending = function () {
  return this.status === "pending" && !this.isExpired();
};

const Invitation = mongoose.model("Invitation", invitationSchema);

export default Invitation;

