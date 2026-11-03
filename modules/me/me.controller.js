import { getUserWorkspaces, getUserAiSubscription, getOrganizationStaff } from "./me.service.js";
import { ApiResponse } from "../../utils/ApiResponse.js";

/**
 * Controller to get all accessible workspaces for current user
 * GET /api/me/workspaces
 */
export const getWorkspacesController = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(403).json(
        new ApiResponse(null, "User not found. Please complete registration first.", 403)
      );
    }

    const workspaces = await getUserWorkspaces(req.user._id);

    return res.status(200).json(
      new ApiResponse(workspaces, "Workspaces fetched successfully", 200)
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

/**
 * Controller to get account AI subscription status and credit usage
 * GET /api/me/ai-subscription
 */
export const getAiSubscriptionController = async (req, res) => {
  try {
    const aiSubscription = await getUserAiSubscription(req.user);
    return res.status(200).json(
      new ApiResponse(aiSubscription, "AI Subscription details fetched successfully", 200)
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

/**
 * Controller to get all staff across all stores owned by the current user
 * GET /api/me/staff
 */
export const getOrganizationStaffController = async (req, res) => {
  try {
    const staffData = await getOrganizationStaff(req.user._id);
    return res.status(200).json(
      new ApiResponse(staffData, "Organization staff fetched successfully", 200)
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

