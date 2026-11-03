import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: [true, "Store reference is required"],
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Actor user reference is required"],
      index: true,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    invitation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invitation",
      default: null,
    },
    action: {
      type: String,
      required: [true, "Action is required"],
      enum: [
        "employee.invited",
        "invitation.accepted",
        "invitation.revoked",
        "employee.role_updated",
        "employee.suspended",
        "employee.reactivated",
        "employee.removed",
      ],
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ store: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;

