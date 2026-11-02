import express from "express";
import {
  createCartController,
  startScanningController,
  addItemController,
  processPaymentController,
  confirmPaymentController,
  getProductByBarcodeController,
  getBillHistoryController,
  quickCheckoutController,
} from "./cart.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";

const router = express.Router();

router.post("/quick-checkout", authMiddleware, quickCheckoutController);
router.post("/create", authMiddleware, createCartController);
router.patch("/:cartId/start-scan", authMiddleware, startScanningController);
router.get(
  "/:cartId/product/:barcode",
  authMiddleware,
  getProductByBarcodeController,
);
router.post("/:cartId/items", authMiddleware, addItemController);
router.post("/:cartId/payment", authMiddleware, processPaymentController);
router.patch(
  "/:cartId/confirm-payment",
  authMiddleware,
  confirmPaymentController,
);
router.get("/store/:storeId/history", authMiddleware, getBillHistoryController);

export default router;
