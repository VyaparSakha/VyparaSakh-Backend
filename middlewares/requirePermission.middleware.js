import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { Store, Employee } from "../models/index.js";
import { ALL_PERMISSIONS } from "../utils/permissions.js";

const requirePermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      const storeId =
        req.params?.storeId ||
        req.query?.storeId ||
        req.body?.storeId ||
        req.body?.store ||
        req.headers?.["x-store-id"];
      const userId = req.user?._id;

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
      const currentStoreId = store._id ? store._id.toString() : storeId.toString();

      // Store owner bypass - full access to own store
      if (storeOwnerId === currentUserId) {
        req.store = store;
        req.userRole = "owner";
        req.authContext = {
          storeId: currentStoreId,
          userId: currentUserId,
          membershipType: "owner",
          isOwner: true,
          employeeId: null,
          roleId: null,
          roleName: "Owner",
          permissions: ALL_PERMISSIONS,
        };
        return next();
      }

      // Check active employee membership
      const employeeQuery = Employee.findOne({
        store: store._id || storeId,
        user: userId,
        status: "active",
      });

      const employee =
        employeeQuery && typeof employeeQuery.populate === "function"
          ? await employeeQuery.populate("role")
          : await employeeQuery;

      if (!employee || !employee.role) {
        return res.status(403).json({
          success: false,
          message: "Access Denied: You do not have permission to access this store.",
          statusCode: 403,
        });
      }

      // Prevent using roles belonging to other stores
      const roleStoreId = employee.role.store?._id
        ? employee.role.store._id.toString()
        : employee.role.store?.toString();

      if (roleStoreId && roleStoreId !== currentStoreId) {
        return res.status(403).json({
          success: false,
          message: "Access Denied: Role belongs to another store.",
          statusCode: 403,
        });
      }

      const userPermissions = Array.isArray(employee.role.permissions)
        ? employee.role.permissions
        : [];

      // Check specific permission if required
      if (!permissionKey || userPermissions.includes(permissionKey)) {
        req.store = store;
        req.employee = employee;
        req.userRole = employee.role.name || "Employee";
        req.authContext = {
          storeId: currentStoreId,
          userId: currentUserId,
          membershipType: "employee",
          isOwner: false,
          employeeId: employee._id ? employee._id.toString() : null,
          roleId: employee.role._id ? employee.role._id.toString() : null,
          roleName: employee.role.name || "Employee",
          permissions: userPermissions,
        };
        return next();
      }

      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have the required permission (${permissionKey}) for this action.`,
        statusCode: 403,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Internal Server Error",
        statusCode: error.statusCode || 500,
      });
    }
  };
};

export default requirePermission;
