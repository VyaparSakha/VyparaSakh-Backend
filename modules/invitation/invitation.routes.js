import { Router } from "express";
import {
  validateInvitationController,
  acceptInvitationController,
} from "./invitation.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";

const router = Router();

// Public route — anyone with the link can preview the invite
router.get("/:token", validateInvitationController);

// Protected route — user must be authenticated and email-verified to accept
router.post("/:token/accept", authMiddleware, requireUser, acceptInvitationController);

export default router;

