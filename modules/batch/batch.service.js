import Batch from "../../models/batch.model.js";
import { Product, Inventory } from "../../models/index.js";
import { ApiError } from "../../utils/ApiError.js";

/**
 * Generate a sequential batch number for a product.
 * Format: BATCH-001, BATCH-002, ...
 */
export const generateBatchNumber = async (productId) => {
  const count = await Batch.countDocuments({ productId });
  return `BATCH-${String(count + 1).padStart(3, "0")}`;
};

/**
 * Recalculate and update Product.quantity as the sum of active batch quantities.
 * This keeps the denormalized cache accurate for existing code (billing, low-stock, analytics).
 */
export const syncProductQuantity = async (productId, storeId = null) => {
  // All batches for this productId belong to this product.
  // Finding by productId directly avoids any store string vs ObjectId type mismatch.
  const activeBatches = await Batch.find({
    productId,
    isArchived: false,
  });
  const totalQty = activeBatches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);

  await Product.findByIdAndUpdate(productId, { quantity: totalQty });

  // Also sync Inventory record if it exists
  try {
    const invQuery = { product: productId };
    if (storeId && storeId !== "undefined" && storeId !== "null" && typeof storeId === "string") {
      invQuery.store = storeId;
    }
    const inv = await Inventory.findOne(invQuery);
    if (inv) {
      inv.quantity = totalQty;
      await inv.save();
    }
  } catch (err) {
    console.warn("[BATCH SERVICE] Could not sync Inventory:", err.message);
  }

  return totalQty;
};

/**
 * Create the first batch for a newly created product.
 * Called by addProduct in product.service.js.
 */
export const createFirstBatch = async ({
  productId,
  storeId,
  createdBy,
  quantity,
  buyingPrice,
  sellingPrice,
  expiryDate,
  batchNumber,
}) => {
  const bn = batchNumber || (await generateBatchNumber(productId));

  // Check if first batch already exists
  const existing = await Batch.findOne({ productId, batchNumber: bn });
  if (existing) {
    return existing;
  }

  const batch = await Batch.create({
    productId,
    store: storeId,
    batchNumber: bn,
    expiryDate: expiryDate || null,
    quantity: Math.max(0, Number(quantity) || 0),
    buyingPrice: Math.max(0, Number(buyingPrice) || 0),
    sellingPrice: Math.max(0, Number(sellingPrice) || 0),
    createdBy: createdBy || null,
  });

  return batch;
};

/**
 * Create a new batch for an existing product.
 * Returns the new batch. Also syncs Product.quantity.
 */
export const createBatch = async (productId, batchData, storeId = null, userId = null) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError("Product not found", 404);
  }

  const effectiveStoreId = storeId || batchData?.storeId || batchData?.store || product.store;
  if (!effectiveStoreId) {
    throw new ApiError("Store reference is required", 400);
  }

  const bn = batchData.batchNumber?.trim() || (await generateBatchNumber(productId));

  // If batch with same batch number already exists -> update initial quantity + entered quantity
  const existing = await Batch.findOne({ productId, batchNumber: bn });
  if (existing) {
    const additionalQty = Math.max(0, Number(batchData.quantity) || 0);
    existing.quantity = (existing.quantity || 0) + additionalQty;
    if (batchData.expiryDate) {
      existing.expiryDate = batchData.expiryDate;
    }
    if (batchData.sellingPrice !== undefined && Number(batchData.sellingPrice) > 0) {
      existing.sellingPrice = Number(batchData.sellingPrice);
    }
    if (batchData.buyingPrice !== undefined && Number(batchData.buyingPrice) > 0) {
      existing.buyingPrice = Number(batchData.buyingPrice);
    }
    if (existing.isArchived && existing.quantity > 0) {
      existing.isArchived = false;
    }
    await existing.save();
    await syncProductQuantity(productId, effectiveStoreId);
    return existing;
  }

  const batch = await Batch.create({
    productId,
    store: effectiveStoreId,
    batchNumber: bn,
    expiryDate: batchData.expiryDate || null,
    manufacturingDate: batchData.manufacturingDate || null,
    quantity: Math.max(0, Number(batchData.quantity) || 0),
    buyingPrice: Math.max(0, Number(batchData.buyingPrice) || 0),
    sellingPrice: Math.max(0, Number(batchData.sellingPrice) || 0),
    createdBy: userId || product.createdBy || null,
  });

  // Keep Product.quantity in sync
  await syncProductQuantity(productId, effectiveStoreId);

  return batch;
};

/**
 * Add stock to an existing batch.
 * Returns the updated batch. Also syncs Product.quantity.
 */
export const addStockToBatch = async (batchId, additionalQty, storeId = null, userId = null) => {
  const batch = await Batch.findById(batchId);
  if (!batch) {
    throw new ApiError("Batch not found", 404);
  }

  const qty = Number(additionalQty);
  if (isNaN(qty) || qty <= 0) {
    throw new ApiError("Additional quantity must be a positive number", 400);
  }

  batch.quantity = (Number(batch.quantity) || 0) + qty;
  // If it was archived (qty was 0 before), un-archive it
  if (batch.isArchived) {
    batch.isArchived = false;
  }
  await batch.save();

  // Keep Product.quantity in sync
  await syncProductQuantity(batch.productId, batch.store);

  return batch;
};

/**
 * Get all active (non-archived) batches for a product.
 * Sorted by expiryDate ascending (FEFO — First Expired, First Out).
 */
export const getActiveBatchesByProduct = async (productId, storeId = null) => {
  const query = { productId, isArchived: false };
  if (storeId && storeId !== "undefined" && storeId !== "null") query.store = storeId;
  let batches = await Batch.find(query).sort({ expiryDate: 1 });

  if (batches.length === 0) {
    try {
      const product = await Product.findById(productId);
      if (product) {
        const batchNum = product.batchNumber || "BATCH-001";
        const initialBatch = await Batch.create({
          productId: product._id,
          store: product.store,
          batchNumber: batchNum,
          expiryDate: product.expDate || null,
          quantity: Math.max(0, Number(product.quantity) || 0),
          buyingPrice: Math.max(0, Number(product.buyingPrice) || 0),
          sellingPrice: Math.max(0, Number(product.sellingPrice) || 0),
          createdBy: product.createdBy || null,
          isArchived: Number(product.quantity || 0) === 0,
        });
        if (!initialBatch.isArchived) {
          batches = [initialBatch];
        }
      }
    } catch (backfillErr) {
      console.warn("[BATCH SERVICE] Auto-backfill active batch error:", backfillErr.message);
    }
  }

  return batches;
};

/**
 * Get all batches (including archived) for a product.
 * If product has stock but 0 batches, automatically creates BATCH-001 for seamless backward-compatibility.
 */
export const getAllBatchesByProduct = async (productId, storeId = null) => {
  const query = { productId };
  if (storeId && storeId !== "undefined" && storeId !== "null") query.store = storeId;

  let batches = await Batch.find(query).sort({
    isArchived: 1,
    expiryDate: 1,
  });

  // Auto-backfill: if product has no batches yet, generate BATCH-001 from product data
  if (batches.length === 0) {
    try {
      const product = await Product.findById(productId);
      if (product) {
        const initialBatch = await Batch.create({
          productId: product._id,
          store: product.store,
          batchNumber: product.batchNumber || "BATCH-001",
          expiryDate: product.expDate || null,
          quantity: Math.max(0, Number(product.quantity) || 0),
          buyingPrice: Math.max(0, Number(product.buyingPrice) || 0),
          sellingPrice: Math.max(0, Number(product.sellingPrice) || 0),
          createdBy: product.createdBy || null,
          isArchived: Number(product.quantity || 0) === 0,
        });
        batches = [initialBatch];
      }
    } catch (backfillErr) {
      console.warn("[BATCH SERVICE] Auto-backfill batch error:", backfillErr.message);
    }
  }

  return batches;
};

/**
 * Archive a batch manually (e.g., wastage, recall).
 */
export const archiveBatch = async (batchId, storeId = null) => {
  const batch = await Batch.findById(batchId);
  if (!batch) {
    throw new ApiError("Batch not found", 404);
  }
  batch.isArchived = true;
  await batch.save();
  await syncProductQuantity(batch.productId, batch.store);
  return batch;
};

/**
 * Decrement quantity from a specific batch after a sale.
 * Falls back to decrementing the batch with earliest expiry (FEFO) if batchId not provided.
 */
export const decrementBatchStock = async (
  productId,
  storeId,
  qtyToSubtract,
  batchId = null
) => {
  if (batchId) {
    const batch = await Batch.findOne({
      _id: batchId,
      productId,
      store: storeId,
    });
    if (!batch) return null;
    batch.quantity = Math.max(0, batch.quantity - qtyToSubtract);
    await batch.save();
    await syncProductQuantity(productId, storeId);
    return [batch];
  }

  // FEFO: subtract from earliest-expiry active batches
  const batches = await Batch.find({
    productId,
    store: storeId,
    isArchived: false,
    quantity: { $gt: 0 },
  }).sort({ expiryDate: 1 });

  let remaining = qtyToSubtract;
  const updated = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    batch.quantity -= take;
    remaining -= take;
    await batch.save();
    updated.push(batch);
  }

  await syncProductQuantity(productId, storeId);
  return updated;
};
