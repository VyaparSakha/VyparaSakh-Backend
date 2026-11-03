import * as invitationService from "../invitation/invitation.service.js";
import { ApiResponse } from "../../utils/ApiResponse.js";

/**
 * GET /api/invite/:token
 * Validates an invite token and returns safe preview info
 */
export const verifyInviteToken = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await invitationService.validateInvitation(token);

    if (!result.valid) {
      const statusCode =
        result.status === "expired" || result.status === "revoked"
          ? 410
          : result.status === "accepted"
          ? 409
          : 404;
      return res.status(statusCode).json(new ApiResponse(result, result.message, statusCode));
    }

    return res.status(200).json(new ApiResponse(result, "Invitation details verified", 200));
  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

/**
 * POST /api/invite/:token/accept
 * Accept an invitation (logged-in user with matching verified email)
 */
export const acceptInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await invitationService.acceptInvitation(token, req.user, req.firebaseUser);

    return res.status(200).json(new ApiResponse(result, "You have successfully joined the store!", 200));
  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

/**
 * POST /api/invite/:token/decline
 * Decline an invitation
 */
export const declineInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const result = await invitationService.validateInvitation(token);
    // Decline just leaves or marks invalid
    return res.status(200).json(new ApiResponse({ declined: true }, "Invitation declined.", 200));
  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};
