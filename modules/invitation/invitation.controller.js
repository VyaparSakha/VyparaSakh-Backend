import * as invitationService from "./invitation.service.js";
import { ApiResponse } from "../../utils/ApiResponse.js";

/**
 * POST /api/stores/:storeId/invitations
 */
export const createInvitationController = async (req, res) => {
  try {
    const { storeId } = req.params;
    const actorUserId = req.user._id;
    const invitation = await invitationService.createInvitation(
      storeId,
      actorUserId,
      req.body
    );
    res
      .status(201)
      .json(new ApiResponse(invitation, "Invitation sent successfully", 201));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(
        new ApiResponse(
          null,
          error.message || "Internal Server Error",
          error.statusCode || 500
        )
      );
  }
};

/**
 * GET /api/invitations/:token
 */
export const validateInvitationController = async (req, res) => {
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
      return res
        .status(statusCode)
        .json(new ApiResponse(result, result.message, statusCode));
    }

    res
      .status(200)
      .json(new ApiResponse(result, "Invitation details verified", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(
        new ApiResponse(
          null,
          error.message || "Internal Server Error",
          error.statusCode || 500
        )
      );
  }
};

/**
 * POST /api/invitations/:token/accept
 */
export const acceptInvitationController = async (req, res) => {
  try {
    const { token } = req.params;
    const currentUser = req.user;
    const firebaseUser = req.firebaseUser;
    const result = await invitationService.acceptInvitation(
      token,
      currentUser,
      firebaseUser
    );
    res
      .status(200)
      .json(new ApiResponse(result, "Invitation accepted successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(
        new ApiResponse(
          null,
          error.message || "Internal Server Error",
          error.statusCode || 500
        )
      );
  }
};

/**
 * POST /api/stores/:storeId/invitations/:invitationId/revoke
 */
export const revokeInvitationController = async (req, res) => {
  try {
    const { storeId, invitationId } = req.params;
    const actorUserId = req.user._id;
    const result = await invitationService.revokeInvitation(
      storeId,
      invitationId,
      actorUserId
    );
    res
      .status(200)
      .json(new ApiResponse(result, "Invitation revoked successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(
        new ApiResponse(
          null,
          error.message || "Internal Server Error",
          error.statusCode || 500
        )
      );
  }
};

/**
 * GET /api/stores/:storeId/invitations
 */
export const getInvitationsByStoreController = async (req, res) => {
  try {
    const { storeId } = req.params;
    const invitations = await invitationService.getInvitationsByStore(storeId);
    res
      .status(200)
      .json(new ApiResponse(invitations, "Invitations fetched successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(
        new ApiResponse(
          null,
          error.message || "Internal Server Error",
          error.statusCode || 500
        )
      );
  }
};

