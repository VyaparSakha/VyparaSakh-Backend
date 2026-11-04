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
 * Automatically archives any batch whose quantity has become 0.
 */
export const syncProductQuantity = async (productId, storeId = null) => {
  // Automatically archive any batch whose quantity became 0
  await Batch.updateMany(
    { productId, quantity: { $lte: 0 }, isArchived: false },
    { $set: { isArchived: true, quantity: 0 } }
  );

  // All active batches with quantity > 0
  const activeBatches = await Batch.find({
    productId,
    isArchived: false,
    quantity: { $gt: 0 },
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
  const qty = Math.max(0, Number(quantity) || 0);

  // Check if first batch already exists
  const existing = await Batch.findOne({ productId, batchNumber: bn });
  if (existing) {
    if (qty > 0 && existing.isArchived) {
      existing.isArchived = false;
      existing.quantity = qty;
      await existing.save();
    }
    return existing;
  }

  const batch = await Batch.create({
    productId,
    store: storeId,
    batchNumber: bn,
    expiryDate: expiryDate || null,
    quantity: qty,
    buyingPrice: Math.max(0, Number(buyingPrice) || 0),
    sellingPrice: Math.max(0, Number(sellingPrice) || 0),
    createdBy: createdBy || null,
    isArchived: qty === 0,
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
  const qty = Math.max(0, Number(batchData.quantity) || 0);

  // If batch with same batch number already exists -> update initial quantity + entered quantity
  const existing = await Batch.findOne({ productId, batchNumber: bn });
  if (existing) {
    existing.quantity = (existing.quantity || 0) + qty;
    if (batchData.expiryDate) {
      existing.expiryDate = batchData.expiryDate;
    }
    if (batchData.buyingPrice !== undefined) {
      existing.buyingPrice = Math.max(0, Number(batchData.buyingPrice) || 0);
    }
    if (batchData.sellingPrice !== undefined) {
      existing.sellingPrice = Math.max(0, Number(batchData.sellingPrice) || 0);
    }
    if (existing.quantity > 0) {
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
    quantity: qty,
    buyingPrice: Math.max(0, Number(batchData.buyingPrice ?? product.buyingPrice ?? 0)),
    sellingPrice: Math.max(0, Number(batchData.sellingPrice ?? product.sellingPrice ?? 0)),
    createdBy: userId || null,
    isArchived: qty === 0,
  });

  await syncProductQuantity(productId, effectiveStoreId);
  return batch;
};

/**
 * Add stock to an existing batch.
 * Increments quantity and syncs Product.quantity. Unarchives batch if stock becomes > 0.
 */
export const addStockToBatch = async (batchId, additionalQty, storeId = null, userId = null) => {
  const batch = await Batch.findById(batchId);
  if (!batch) {
    throw new ApiError("Batch not found", 404);
  }

  const qty = Number(additionalQty);
  if (isNaN(qty) || qty <= 0) {
    throw new ApiError("Quantity to add must be a positive number", 400);
  }

  batch.quantity = (batch.quantity || 0) + qty;
  // If it was archived (qty was 0 before), un-archive it
  if (batch.quantity > 0) {
    batch.isArchived = false;
  }
  await batch.save();

  await syncProductQuantity(batch.productId, storeId || batch.store);
  return batch;
};

/**
 * Get all active (non-archived) batches for a product with quantity > 0.
 * Sorted by expiryDate ascending (FEFO — First Expired, First Out).
 */
export const getActiveBatchesByProduct = async (productId, storeId = null) => {
  // Automatically archive any batches with quantity <= 0
  await Batch.updateMany(
    { productId, quantity: { $lte: 0 }, isArchived: false },
    { $set: { isArchived: true, quantity: 0 } }
  );

  const query = { productId, isArchived: false, quantity: { $gt: 0 } };
  if (storeId && storeId !== "undefined" && storeId !== "null") query.store = storeId;
  let batches = await Batch.find(query).sort({ expiryDate: 1 });

  return batches;
};

/**
 * Get all available batches for a product.
 * Returns only active batches with quantity > 0.
 */
export const getAllBatchesByProduct = async (productId, storeId = null) => {
  // Automatically archive any batches with quantity <= 0
  await Batch.updateMany(
    { productId, quantity: { $lte: 0 }, isArchived: false },
    { $set: { isArchived: true, quantity: 0 } }
  );

  const query = { productId, isArchived: false, quantity: { $gt: 0 } };
  if (storeId && storeId !== "undefined" && storeId !== "null") query.store = storeId;

  let batches = await Batch.find(query).sort({ expiryDate: 1 });
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
  batch.quantity = 0;
  await batch.save();

  await syncProductQuantity(batch.productId, storeId || batch.store);
  return batch;
};

/**
 * Decrement quantity from a specific batch after a sale.
 * When quantity becomes 0, automatically archives the batch so it is removed from all available places.
 * Falls back to decrementing the batch with earliest expiry (FEFO) if batchId not provided.
 */
export const decrementBatchStock = async (
  productId,
  storeId,
  qtyToSubtract,
  batchId = null
) => {
  if (batchId) {
    const query = { _id: batchId, productId };
    if (storeId) query.store = storeId;
    let batch = await Batch.findOne(query);
    if (!batch) {
      batch = await Batch.findOne({ _id: batchId, productId });
    }
    if (!batch) return null;

    batch.quantity = Math.max(0, batch.quantity - qtyToSubtract);
    if (batch.quantity === 0) {
      batch.isArchived = true;
    }
    await batch.save();
    await syncProductQuantity(productId, storeId);
    return [batch];
  }

  // FEFO: subtract from earliest-expiry active batches with quantity > 0
  const batches = await Batch.find({
    productId,
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
    if (batch.quantity === 0) {
      batch.isArchived = true;
    }
    await batch.save();
    updated.push(batch);
  }

  await syncProductQuantity(productId, storeId);
  return updated;
};
