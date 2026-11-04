import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import {
  createBatchController,
  addStockController,
  getActiveBatchesController,
  archiveBatchController,
  getNextBatchNumberController,
} from "./batch.controller.js";

const router = Router();

// All batch routes require authentication
router.use(authMiddleware);
router.use(requireUser);

// GET /batches/product/:productId — Fetch batches for a product
router.get("/product/:productId", getActiveBatchesController);

// GET /batches/next-number/:productId — Get next auto-generated batch number
router.get("/next-number/:productId", getNextBatchNumberController);

// POST /batches — Create a new batch for an existing product
router.post("/", createBatchController);

// PATCH /batches/:id/stock — Add stock to an existing batch
router.patch("/:id/stock", addStockController);

// PATCH /batches/:id/archive — Archive a batch manually
router.patch("/:id/archive", archiveBatchController);

export default router;
