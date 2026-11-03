import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { Store } from "../models/index.js";
import { ALL_PERMISSIONS } from "../utils/permissions.js";

const requireOwner = async (req, res, next) => {
  try {
    const storeId =
      req.params?.storeId ||
      req.params?.id ||
      req.query?.storeId ||
      req.body?.storeId ||
      req.body?.store ||
      req.headers?.["x-store-id"];

    if (!storeId) {
      throw new ApiError("Store ID is required in request parameters", 400);
    }

    if (typeof storeId === "string" && !mongoose.Types.ObjectId.isValid(storeId)) {
      throw new ApiError("Invalid Store ID format", 400);
    }

    if (!req.user || !req.user._id) {
      throw new ApiError("User context missing", 401);
    }

    const store = await Store.findById(storeId);

    if (!store || !store.isActive) {
      throw new ApiError("Store not found", 404);
    }

    const storeOwnerId = store.owner?._id ? store.owner._id.toString() : store.owner?.toString();
    const currentUserId = req.user._id.toString();

    if (storeOwnerId !== currentUserId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only the store owner can perform this action.",
        statusCode: 403,
      });
    }

    req.store = store;
    req.userRole = "owner";
    req.authContext = {
      storeId: store._id.toString(),
      userId: currentUserId,
      membershipType: "owner",
      isOwner: true,
      employeeId: null,
      roleId: null,
      roleName: "Owner",
      permissions: ALL_PERMISSIONS,
    };

    next();
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      statusCode: error.statusCode || 500,
    });
  }
};

export default requireOwner;
