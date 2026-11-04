import {
  createBatch,
  addStockToBatch,
  getActiveBatchesByProduct,
  getAllBatchesByProduct,
  archiveBatch,
  generateBatchNumber,
} from "./batch.service.js";
import { ApiResponse } from "../../utils/ApiResponse.js";

// POST /batches — Create a new batch for an existing product
export const createBatchController = async (req, res) => {
  try {
    const storeId = req.body?.storeId || req.query?.storeId || req.headers?.["x-store-id"];
    const userId = req.user?._id;
    const { productId, ...batchData } = req.body;

    if (!productId) {
      return res
        .status(400)
        .json(new ApiResponse(null, "productId is required", 400));
    }

    const batch = await createBatch(productId, batchData, storeId, userId);
    res
      .status(201)
      .json(new ApiResponse(batch, "Batch created successfully", 201));
  } catch (error) {
    console.error("[BATCH CONTROLLER] Error creating batch:", error);
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message, error.statusCode || 500));
  }
};

// PATCH /batches/:id/stock — Add stock to an existing batch
export const addStockController = async (req, res) => {
  try {
    const storeId = req.body?.storeId || req.query?.storeId || req.headers?.["x-store-id"];
    const userId = req.user?._id;
    const { additionalQty } = req.body;

    const batch = await addStockToBatch(
      req.params.id,
      additionalQty,
      storeId,
      userId
    );
    res
      .status(200)
      .json(new ApiResponse(batch, "Stock added to batch successfully", 200));
  } catch (error) {
    console.error("[BATCH CONTROLLER] Error adding stock:", error);
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message, error.statusCode || 500));
  }
};

// GET /batches/product/:productId — Get active batches for a product
export const getActiveBatchesController = async (req, res) => {
  try {
    const storeId = req.query?.storeId || req.headers?.["x-store-id"];
    const { productId } = req.params;
    const includeArchived = req.query?.includeArchived === "true";

    const batches = includeArchived
      ? await getAllBatchesByProduct(productId, storeId)
      : await getActiveBatchesByProduct(productId, storeId);

    res
      .status(200)
      .json(new ApiResponse(batches, "Batches fetched successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message, error.statusCode || 500));
  }
};

// PATCH /batches/:id/archive — Archive a batch manually
export const archiveBatchController = async (req, res) => {
  try {
    const storeId = req.query?.storeId || req.headers?.["x-store-id"];
    const batch = await archiveBatch(req.params.id, storeId);
    res
      .status(200)
      .json(new ApiResponse(batch, "Batch archived successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message, error.statusCode || 500));
  }
};

// GET /batches/next-number/:productId — Preview next auto-generated batch number
export const getNextBatchNumberController = async (req, res) => {
  try {
    const { productId } = req.params;
    const nextNumber = await generateBatchNumber(productId);
    res.status(200).json(new ApiResponse({ batchNumber: nextNumber }, "Next batch number generated", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message, error.statusCode || 500));
  }
};
