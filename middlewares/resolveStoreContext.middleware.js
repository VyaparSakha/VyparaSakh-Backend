import mongoose from "mongoose";
import { Store, Employee } from "../models/index.js";
import { ApiError } from "../utils/ApiError.js";
import { ALL_PERMISSIONS } from "../utils/permissions.js";

/**
 * Resolves the authenticated user's access context for a given store.
 * Checks whether user is the owner or an active employee with a valid role.
 *
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<Object>} Authorization context
 */
export const resolveStoreContextForUser = async (storeId, userId) => {
  if (!storeId) {
    throw new ApiError("Store ID is required in request parameters", 400);
  }

  if (typeof storeId === "string" && !mongoose.Types.ObjectId.isValid(storeId)) {
    throw new ApiError("Invalid Store ID format", 400);
  }

  if (!userId) {
    throw new ApiError("User context missing", 401);
  }

  const store = await Store.findById(storeId);
  if (!store) {
    throw new ApiError("Store not found", 404);
  }

  const storeOwnerId = store.owner?._id ? store.owner._id.toString() : store.owner?.toString();
  const currentUserId = userId.toString();

  // 1. Owner relationship
  if (storeOwnerId === currentUserId) {
    return {
      store,
      storeId: store._id ? store._id.toString() : storeId.toString(),
      userId: currentUserId,
      membershipType: "owner",
      isOwner: true,
      employee: null,
      employeeId: null,
      roleId: null,
      roleName: "Owner",
      permissions: ALL_PERMISSIONS,
    };
  }

  // 2. Active Employee relationship
  const employeeQuery = Employee.findOne({
    store: store._id || storeId,
    user: userId,
    status: "active",
  });

  const employee = employeeQuery && typeof employeeQuery.populate === "function"
    ? await employeeQuery.populate("role")
    : await employeeQuery;

  if (!employee || !employee.role) {
    throw new ApiError("Access Denied: You do not have permission to access this store.", 403);
  }

  // Ensure role belongs to this store or is a global system template
  const roleStoreId = employee.role.store?._id ? employee.role.store._id.toString() : employee.role.store?.toString();
  const currentStoreId = store._id ? store._id.toString() : storeId.toString();

  if (roleStoreId && roleStoreId !== currentStoreId) {
    throw new ApiError("Access Denied: Role belongs to another store.", 403);
  }

  return {
    store,
    storeId: currentStoreId,
    userId: currentUserId,
    membershipType: "employee",
    isOwner: false,
    employee,
    employeeId: employee._id ? employee._id.toString() : null,
    roleId: employee.role._id ? employee.role._id.toString() : null,
    roleName: employee.role.name || "Employee",
    permissions: employee.role.permissions || [],
  };
};

/**
 * Middleware to resolve store authorization context and attach it to req.authContext
 */
export const storeContextMiddleware = async (req, res, next) => {
  try {
    const storeId = req.params?.storeId || req.params?.id || req.query?.storeId || req.body?.storeId || req.body?.store || req.headers["x-store-id"];
    const userId = req.user?._id;

    const authContext = await resolveStoreContextForUser(storeId, userId);

    req.authContext = authContext;
    req.store = authContext.store;
    req.employee = authContext.employee;
    req.userRole = authContext.isOwner ? "owner" : authContext.roleName;

    next();
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      statusCode: error.statusCode || 500,
    });
  }
};

