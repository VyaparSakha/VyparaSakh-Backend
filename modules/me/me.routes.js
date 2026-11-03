import { Router } from "express";
import { getWorkspacesController } from "./me.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";

const router = Router();

router.use(authMiddleware);
router.use(requireUser);

router.get("/workspaces", getWorkspacesController);

export default router;

