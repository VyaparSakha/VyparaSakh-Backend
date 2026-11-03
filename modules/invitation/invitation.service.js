import mongoose from "mongoose";
import { Invitation, Employee, Store, Role, User } from "../../models/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { generateInvitationToken, hashInvitationToken } from "../../utils/tokenUtils.js";
import { sendInviteEmail } from "../../utils/mailer.js";
import { logAudit } from "../../utils/auditLogger.js";

/**
 * Creates an invitation for a registered or unregistered user.
 * Generates a crypto token, saves only the SHA-256 hash in DB, and emails the raw token.
 *
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {string|mongoose.Types.ObjectId} actorUserId
 * @param {Object} data - { email, roleId }
 */
export const createInvitation = async (storeId, actorUserId, { email, roleId }) => {
  if (!email || !roleId) {
    throw new ApiError("Email and role are required", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    throw new ApiError("Please provide a valid email address", 400);
  }

  const store = await Store.findById(storeId);
  if (!store || !store.isActive) {
    throw new ApiError("Store not found or inactive", 404);
  }

  // Prevent inviting store owner as employee
  const storeOwner = await User.findById(store.owner);
  if (storeOwner && storeOwner.email.trim().toLowerCase() === normalizedEmail) {
    throw new ApiError("Store owner cannot be invited as an employee of their own store", 400);
  }

  // Validate role exists and belongs to this store
  const role = await Role.findById(roleId);
  if (!role) {
    throw new ApiError("Role not found", 404);
  }
  if (role.store && role.store.toString() !== storeId.toString()) {
    throw new ApiError("Role does not belong to this store", 403);
  }

  // Check if an existing registered user is already an active employee of this store
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    const existingMembership = await Employee.findOne({
      store: storeId,
      user: existingUser._id,
      status: "active",
    });
    if (existingMembership) {
      throw new ApiError("User is already an active employee of this store", 409);
    }
  }

  // Check for duplicate pending invitation in this store
  const existingInvite = await Invitation.findOne({
    store: storeId,
    email: normalizedEmail,
    status: "pending",
  });

  if (existingInvite) {
    if (existingInvite.isExpired()) {
      existingInvite.status = "expired";
      await existingInvite.save();
    } else {
      throw new ApiError("A pending invitation already exists for this email in this store", 409);
    }
  }

  // Generate cryptographically secure token & hash
  const { rawToken, tokenHash } = generateInvitationToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  const invitation = await Invitation.create({
    store: storeId,
    email: normalizedEmail,
    role: roleId,
    invitedBy: actorUserId,
    tokenHash,
    status: "pending",
    expiresAt,
  });

  // Fetch inviter info for email
  const inviterQuery = User.findById(actorUserId);
  const inviter = inviterQuery && typeof inviterQuery.select === "function"
    ? await inviterQuery.select("name")
    : await inviterQuery;

  // Send invitation email with retry
  try {
    await sendInviteEmail(normalizedEmail, {
      storeName: store.name,
      roleName: role.name,
      ownerName: inviter?.name || "The store owner",
      inviteToken: rawToken,
    });
  } catch (emailError) {
    // If delivery failed completely, remove the invitation record so user isn't stuck with a phantom invite
    await Invitation.deleteOne({ _id: invitation._id });
    console.error("[INVITATION] Email delivery failed:", emailError.message);
    throw new ApiError(`Failed to send invitation email: ${emailError.message}`, 502);
  }

  // Log audit
  await logAudit({
    storeId,
    actorUserId,
    targetUserId: existingUser?._id || null,
    invitationId: invitation._id,
    action: "employee.invited",
    metadata: {
      email: normalizedEmail,
      roleId: role._id.toString(),
      roleName: role.name,
    },
  });

  return {
    invitationId: invitation._id,
    store: storeId,
    email: normalizedEmail,
    role: {
      _id: role._id,
      name: role.name,
    },
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    inviteToken: rawToken,
    rawToken,
    testRawToken: rawToken,
  };
};

/**
 * Validates an invitation token and returns safe public preview information.
 *
 * @param {string} rawToken
 */
export const validateInvitation = async (rawToken) => {
  if (!rawToken || typeof rawToken !== "string") {
    return { valid: false, status: "invalid", message: "Invalid invitation token" };
  }

  const tokenHash = hashInvitationToken(rawToken);

  const invitation = await Invitation.findOne({ tokenHash })
    .populate("store", "name isActive")
    .populate("role", "name")
    .populate("invitedBy", "name email");

  // Fallback check for legacy Employee records
  if (!invitation) {
    const legacyEmp = await Employee.findOne({ inviteToken: rawToken })
      .populate("store", "name isActive")
      .populate("role", "name")
      .populate("invitedBy", "name email");

    if (!legacyEmp) {
      return { valid: false, status: "invalid", message: "Invalid or expired invitation link" };
    }

    if (legacyEmp.status === "rejected") {
      return { valid: false, status: "revoked", message: "This invitation has been revoked" };
    }
    if (legacyEmp.status === "active") {
      return { valid: false, status: "accepted", message: "This invitation has already been accepted" };
    }
    if (legacyEmp.inviteTokenExpiry && new Date() > legacyEmp.inviteTokenExpiry) {
      return { valid: false, status: "expired", message: "This invitation has expired" };
    }

    return {
      valid: true,
      status: "pending",
      storeName: legacyEmp.store?.name,
      roleName: legacyEmp.role?.name,
      invitedBy: legacyEmp.invitedBy?.name,
      expiresAt: legacyEmp.inviteTokenExpiry,
    };
  }

  if (invitation.status === "revoked") {
    return { valid: false, status: "revoked", message: "This invitation has been revoked" };
  }

  if (invitation.status === "accepted") {
    return { valid: false, status: "accepted", message: "This invitation has already been accepted" };
  }

  if (invitation.isExpired()) {
    if (invitation.status !== "expired") {
      invitation.status = "expired";
      await invitation.save();
    }
    return { valid: false, status: "expired", message: "This invitation has expired" };
  }

  if (!invitation.store || !invitation.store.isActive) {
    return { valid: false, status: "store_inactive", message: "The store is no longer active" };
  }

  return {
    valid: true,
    status: "pending",
    storeName: invitation.store?.name,
    roleName: invitation.role?.name,
    invitedBy: invitation.invitedBy?.name,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
  };
};

/**
 * Accepts an invitation. Requires authenticated user whose verified email matches the invitation.
 *
 * @param {string} rawToken
 * @param {Object} currentUser - MongoDB User document (req.user)
 * @param {Object} firebaseUser - Decoded Firebase token info (req.firebaseUser)
 */
export const acceptInvitation = async (rawToken, currentUser, firebaseUser) => {
  if (!currentUser || !currentUser._id) {
    throw new ApiError("Authentication required to accept invitation", 401);
  }

  if (!rawToken || typeof rawToken !== "string") {
    throw new ApiError("Invalid invitation token", 400);
  }

  const tokenHash = hashInvitationToken(rawToken);

  let invitation = await Invitation.findOne({ tokenHash });
  let isLegacy = false;
  let legacyEmp = null;

  if (!invitation) {
    legacyEmp = await Employee.findOne({ inviteToken: rawToken });
    if (!legacyEmp) {
      throw new ApiError("Invalid or expired invitation link", 404);
    }
    isLegacy = true;
  }

  if (isLegacy) {
    if (legacyEmp.status === "rejected") throw new ApiError("Invitation has been revoked", 410);
    if (legacyEmp.status === "active") throw new ApiError("Invitation has already been accepted", 409);
    if (legacyEmp.inviteTokenExpiry && new Date() > legacyEmp.inviteTokenExpiry) {
      throw new ApiError("Invitation has expired", 410);
    }
    if (legacyEmp.user.toString() !== currentUser._id.toString()) {
      throw new ApiError("This invitation was sent to a different account", 403);
    }

    legacyEmp.status = "active";
    legacyEmp.joinedAt = new Date();
    legacyEmp.inviteToken = null;
    legacyEmp.inviteTokenExpiry = null;
    await legacyEmp.save();

    return {
      storeId: legacyEmp.store,
      employeeId: legacyEmp._id,
      joinedAt: legacyEmp.joinedAt,
    };
  }

  // Validate status
  if (invitation.status === "revoked") {
    throw new ApiError("Invitation has been revoked", 410);
  }
  if (invitation.status === "accepted") {
    throw new ApiError("Invitation has already been accepted", 409);
  }
  if (invitation.isExpired()) {
    invitation.status = "expired";
    await invitation.save();
    throw new ApiError("Invitation has expired", 410);
  }
  if (invitation.status !== "pending") {
    throw new ApiError(`Invitation is no longer valid (${invitation.status})`, 400);
  }

  // Validate email identity
  const userEmail = (currentUser.email || firebaseUser?.email || "").trim().toLowerCase();
  const inviteEmail = (invitation.email || "").trim().toLowerCase();

  if (!userEmail || userEmail !== inviteEmail) {
    throw new ApiError(
      "This invitation was sent to a different email address. Please login with the invited email.",
      403
    );
  }

  // Validate email verification (if firebaseUser is provided and explicitly unverified)
  if (firebaseUser && firebaseUser.emailVerified === false) {
    throw new ApiError("Please verify your email address before accepting the invitation", 403);
  }

  // Verify store exists and is active
  const store = await Store.findById(invitation.store);
  if (!store || !store.isActive) {
    throw new ApiError("Store no longer exists or is inactive", 404);
  }

  // Verify role still exists and belongs to this store
  const role = await Role.findById(invitation.role);
  if (!role) {
    throw new ApiError("Assigned role no longer exists", 404);
  }
  if (role.store && role.store.toString() !== invitation.store.toString()) {
    throw new ApiError("Role does not belong to this store", 403);
  }

  // Check duplicate active membership
  const existingEmployee = await Employee.findOne({
    store: invitation.store,
    user: currentUser._id,
  });

  if (existingEmployee && existingEmployee.status === "active") {
    throw new ApiError("You are already an active member of this store", 409);
  }

  let employeeRecord;
  if (existingEmployee) {
    existingEmployee.role = invitation.role;
    existingEmployee.status = "active";
    existingEmployee.joinedAt = new Date();
    existingEmployee.invitedBy = invitation.invitedBy;
    existingEmployee.inviteToken = null;
    existingEmployee.inviteTokenExpiry = null;
    await existingEmployee.save();
    employeeRecord = existingEmployee;
  } else {
    employeeRecord = await Employee.create({
      store: invitation.store,
      user: currentUser._id,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      status: "active",
      joinedAt: new Date(),
    });
  }

  // Mark invitation accepted
  invitation.status = "accepted";
  invitation.acceptedBy = currentUser._id;
  invitation.acceptedAt = new Date();
  await invitation.save();

  // Audit log
  await logAudit({
    storeId: invitation.store,
    actorUserId: currentUser._id,
    targetUserId: currentUser._id,
    employeeId: employeeRecord._id,
    invitationId: invitation._id,
    action: "invitation.accepted",
    metadata: {
      roleId: role._id.toString(),
      roleName: role.name,
      email: inviteEmail,
    },
  });

  return {
    storeId: invitation.store,
    employeeId: employeeRecord._id,
    role: role.name,
    joinedAt: employeeRecord.joinedAt,
  };
};

/**
 * Revokes a pending invitation. Owner only.
 *
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {string|mongoose.Types.ObjectId} invitationId
 * @param {string|mongoose.Types.ObjectId} actorUserId
 */
export const revokeInvitation = async (storeId, invitationId, actorUserId) => {
  if (!mongoose.Types.ObjectId.isValid(invitationId)) {
    throw new ApiError("Invalid invitation ID format", 400);
  }

  const invitation = await Invitation.findOne({
    _id: invitationId,
    store: storeId,
  });

  if (!invitation) {
    throw new ApiError("Invitation not found", 404);
  }

  if (invitation.status !== "pending") {
    throw new ApiError(`Cannot revoke invitation that is already ${invitation.status}`, 400);
  }

  invitation.status = "revoked";
  invitation.revokedAt = new Date();
  await invitation.save();

  // Audit log
  await logAudit({
    storeId,
    actorUserId,
    invitationId: invitation._id,
    action: "invitation.revoked",
    metadata: {
      email: invitation.email,
    },
  });

  return {
    invitationId: invitation._id,
    status: invitation.status,
    revokedAt: invitation.revokedAt,
  };
};

/**
 * Lists all invitations for a store. Owner only.
 *
 * @param {string|mongoose.Types.ObjectId} storeId
 */
export const getInvitationsByStore = async (storeId) => {
  return Invitation.find({ store: storeId })
    .select("-tokenHash")
    .populate("role", "name permissions")
    .populate("invitedBy", "name email")
    .populate("acceptedBy", "name email")
    .sort({ createdAt: -1 });
};
