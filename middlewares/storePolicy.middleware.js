import { Store, Employee } from "../models/index.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Validates whether the authenticated user is eligible to create a new store.
 *
 * Rules:
 * - Existing store owners (user owns >= 1 active store): ALLOWED.
 * - Legitimate new signups (0 owned stores, 0 employee memberships): ALLOWED.
 * - Employee-only accounts (0 owned stores, >= 1 active or pending employee membership):
 *   DENIED with 403 Forbidden.
 */
export const requireStoreCreationEligibility = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      throw new ApiError("User not registered. Please complete registration first.", 403);
    }

    // 1. Check if user already owns any store
    const ownedStoresCount = await Store.countDocuments({
      owner: userId,
      isActive: true,
    });

    if (ownedStoresCount > 0) {
      // User is already an owner; permitted to create additional stores
      return next();
    }

    // 2. Check if user is an employee in any store (active or pending invite)
    const employeeMembershipCount = await Employee.countDocuments({
      user: userId,
      status: { $in: ["active", "pending"] },
    });

    if (employeeMembershipCount > 0) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Employee-only accounts are not authorized to create stores.",
        statusCode: 403,
      });
    }

    // 3. New registered user with no stores and no employee records: permitted
    next();
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
      statusCode: error.statusCode || 500,
    });
  }
};

