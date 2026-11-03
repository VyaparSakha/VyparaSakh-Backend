import mongoose from "mongoose";
import { Store, Employee, Invitation } from "../../models/index.js";
import { ALL_PERMISSIONS } from "../../utils/permissions.js";

/**
 * Discovers and returns all workspaces (stores) the authenticated user has access to,
 * either as an owner or as an active employee.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Array<Object>>} List of accessible workspaces
 */
export const getUserWorkspaces = async (userId) => {
  if (!userId) {
    return [];
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Stores owned by the user (must be active)
  const ownedStores = await Store.find({
    owner: userObjectId,
    isActive: true,
  }).sort({ createdAt: 1 });

  const ownedWorkspaces = ownedStores.map((store) => ({
    storeId: store._id.toString(),
    storeName: store.name,
    membershipType: "owner",
    role: "Owner",
    permissions: ALL_PERMISSIONS,
    isOwner: true,
    businessType: store.businessType || "retail",
    address: store.address || {},
    phone: store.phone,
    email: store.email || null,
    logo: store.logo || null,
    seqNumber: store.seqNumber || null,
    settings: store.settings || {},
    createdAt: store.createdAt,
  }));

  // 2. Stores where the user is an active employee
  const employeeMemberships = await Employee.find({
    user: userObjectId,
    status: "active",
  })
    .populate({
      path: "store",
      match: { isActive: true },
    })
    .populate("role");

  const employeeWorkspaces = employeeMemberships
    .filter((membership) => membership.store && membership.role)
    .map((membership) => {
      const store = membership.store;
      const role = membership.role;
      return {
        storeId: store._id.toString(),
        storeName: store.name,
        membershipType: "employee",
        role: role.name || "Employee",
        permissions: role.permissions || [],
        isOwner: false,
        employeeId: membership._id.toString(),
        businessType: store.businessType || "retail",
        address: store.address || {},
        phone: store.phone,
        email: store.email || null,
        logo: store.logo || null,
        seqNumber: store.seqNumber || null,
        settings: store.settings || {},
        createdAt: store.createdAt,
      };
    });

  // Combine and deduplicate by storeId (owner relationship takes priority)
  const workspacesMap = new Map();

  for (const workspace of ownedWorkspaces) {
    workspacesMap.set(workspace.storeId, workspace);
  }

  for (const workspace of employeeWorkspaces) {
    if (!workspacesMap.has(workspace.storeId)) {
      workspacesMap.set(workspace.storeId, workspace);
    }
  }

  return Array.from(workspacesMap.values());
};

/**
 * Returns current user's AI subscription status and credit usage.
 */
export const getUserAiSubscription = async (user) => {
  if (!user) return null;
  // Auto-rollover check
  if (typeof user.hasAiCredits === "function") {
    user.hasAiCredits();
  }
  return user.aiSubscription || {
    plan: "free",
    monthlyLimit: 250,
    usedCredits: 0,
    status: "active",
  };
};

/**
 * Returns all staff and pending invitations across all stores owned by the user.
 */
export const getOrganizationStaff = async (ownerId) => {
  if (!ownerId) {
    return { stores: [], employees: [], pendingInvitations: [] };
  }

  const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

  // 1. All stores owned by this user
  const ownedStores = await Store.find({
    owner: ownerObjectId,
    isActive: true,
  }).select("_id name businessType logo phone address");

  const storeIds = ownedStores.map((s) => s._id);

  if (storeIds.length === 0) {
    return { stores: [], employees: [], pendingInvitations: [] };
  }

  // 2. All employees in these stores
  const employees = await Employee.find({ store: { $in: storeIds } })
    .populate("user", "name email profilePicture phone")
    .populate("role", "name permissions isSystem")
    .populate("store", "name businessType logo")
    .sort({ createdAt: -1 });

  // 3. All pending invitations in these stores
  const pendingInvitations = await Invitation.find({
    store: { $in: storeIds },
    status: "pending",
  })
    .populate("role", "name permissions")
    .populate("store", "name businessType logo")
    .sort({ createdAt: -1 });

  return {
    stores: ownedStores,
    employees,
    pendingInvitations,
  };
};

