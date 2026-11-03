import { Router } from "express";
import {
  getWorkspacesController,
  getAiSubscriptionController,
  getOrganizationStaffController,
} from "./me.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";

const router = Router();

router.use(authMiddleware);
router.use(requireUser);

router.get("/workspaces", getWorkspacesController);
router.get("/ai-subscription", getAiSubscriptionController);
router.get("/staff", getOrganizationStaffController);

export default router;

