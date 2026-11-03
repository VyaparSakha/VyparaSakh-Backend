import express from "express";
import {
  createCartController,
  startScanningController,
  addItemController,
  processPaymentController,
  confirmPaymentController,
  getProductByBarcodeController,
  getBillHistoryController,
} from "./cart.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import requirePermission from "../../middlewares/requirePermission.middleware.js";
import { PERMISSIONS } from "../../utils/permissions.js";

const router = express.Router();

router.use(authMiddleware);
router.use(requireUser);

router.post("/create", createCartController);
router.patch("/:cartId/start-scan", startScanningController);
router.get("/:cartId/product/:barcode", getProductByBarcodeController);
router.post("/:cartId/items", addItemController);
router.post("/:cartId/payment", processPaymentController);
router.patch("/:cartId/confirm-payment", confirmPaymentController);
router.get("/store/:storeId/history", requirePermission(PERMISSIONS.BILLING_CREATE), getBillHistoryController);

export default router;
