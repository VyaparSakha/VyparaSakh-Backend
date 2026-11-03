import { getUserWorkspaces } from "./me.service.js";
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

