import { AuditLog } from "../models/index.js";

/**
 * Records an audit log entry for employee/invitation lifecycle events.
 * Strips sensitive keys (tokens, hashes, passwords) before writing.
 *
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId} options.storeId
 * @param {string|mongoose.Types.ObjectId} options.actorUserId
 * @param {string|mongoose.Types.ObjectId} [options.targetUserId=null]
 * @param {string|mongoose.Types.ObjectId} [options.employeeId=null]
 * @param {string|mongoose.Types.ObjectId} [options.invitationId=null]
 * @param {string} options.action
 * @param {Object} [options.metadata={}]
 */
export const logAudit = async ({
  storeId,
  actorUserId,
  targetUserId = null,
  employeeId = null,
  invitationId = null,
  action,
  metadata = {},
}) => {
  try {
    if (!storeId || !actorUserId || !action) {
      return null;
    }

    const safeMetadata = { ...metadata };
    delete safeMetadata.token;
    delete safeMetadata.rawToken;
    delete safeMetadata.inviteToken;
    delete safeMetadata.tokenHash;
    delete safeMetadata.password;

    const logEntry = await AuditLog.create({
      store: storeId,
      actor: actorUserId,
      targetUser: targetUserId,
      employee: employeeId,
      invitation: invitationId,
      action,
      metadata: safeMetadata,
    });

    return logEntry;
  } catch (error) {
    // Non-blocking error handling to ensure main operations are not blocked
    console.error("[AUDIT LOG ERROR]", error.message);
    return null;
  }
};

