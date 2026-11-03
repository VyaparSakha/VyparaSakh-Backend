import { Router } from "express";
import {
  storeCreateController,
  storeGetController,
  storeUpdateController,
  storeDeleteController,
  storeGetAllController,
  storeSendInstantStockAlertController,
  storeOverviewController,
} from "./store.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import requireOwner from "../../middlewares/requireOwner.middleware.js";
import { requireStoreCreationEligibility } from "../../middlewares/storePolicy.middleware.js";
import roleRoutes from "../role/role.routes.js";
import employeeRoutes from "../employee/employee.routes.js";
import storeInvitationRoutes from "../invitation/storeInvitation.routes.js";

const router = Router();

// All store routes require authentication AND user to exist in DB
router.use(authMiddleware);
router.use(requireUser);

router.route("/all").get(storeGetAllController);
router.route("/create").post(requireStoreCreationEligibility, storeCreateController);

// Nested routes for roles, employees, and invitations under a specific store
router.use("/:storeId/roles", roleRoutes);
router.use("/:storeId/employees", employeeRoutes);
router.use("/:storeId/invitations", storeInvitationRoutes);

router.route("/:storeId/overview").get(storeOverviewController);

router.route("/:storeId").get(storeGetController);
router.route("/:storeId").put(requireOwner, storeUpdateController);
router.route("/:storeId").delete(requireOwner, storeDeleteController);
router.route("/:storeId/send-stock-alert").post(requireOwner, storeSendInstantStockAlertController);

export default router;
