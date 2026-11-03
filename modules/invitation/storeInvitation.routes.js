import { Router } from "express";
import {
  createInvitationController,
  getInvitationsByStoreController,
  revokeInvitationController,
} from "./invitation.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import requireOwner from "../../middlewares/requireOwner.middleware.js";

const router = Router({ mergeParams: true });

// All store invitation operations require store ownership
router.use(authMiddleware);
router.use(requireUser);
router.use(requireOwner);

router.route("/")
  .get(getInvitationsByStoreController)
  .post(createInvitationController);

router.post("/:invitationId/revoke", revokeInvitationController);

export default router;

