import { Product, MasterProduct } from '../../models/index.js';
import Batch from '../../models/batch.model.js';
import { createFirstBatch, getAllBatchesByProduct, syncProductQuantity } from '../batch/batch.service.js';
import { ApiError } from "../../utils/ApiError.js";
import { normalizeProduct } from "./normalizer.service.js";

//create product service
export const addProduct = async (productData) => {
    try {
        if (!productData.name || !productData.category || (productData.price === undefined && productData.sellingPrice === undefined)) {
            throw new ApiError("Name, category, and price are required", 400);
        }

        if (!productData.store) {
            throw new ApiError("Store reference is required", 400);
        }

        if (!productData.createdBy) {
            throw new ApiError("CreatedBy (user) reference is required", 400);
        }

        // 1. Check if product with this barcode already exists in this store
        let existingProduct = null;
        if (productData.barcode && typeof productData.barcode === "string" && productData.barcode.trim() !== "") {
            existingProduct = await Product.findOne({
                store: productData.store,
                barcode: productData.barcode.trim(),
                isActive: true
            });
        }

        // 2. If not found by barcode, check by exact name in this store
        if (!existingProduct && productData.name) {
            existingProduct = await Product.findOne({
                store: productData.store,
                name: { $regex: new RegExp('^' + productData.name.trim() + '$', 'i') },
                isActive: true
            });
        }

        // If product already exists in this store:
        // Case A: Same batch number -> update initial quantity + quantity entered at this time
        // Case B: Different batch number / exp date -> add as a new batch under Available Batches
        if (existingProduct) {
            const incomingBatchNumber = (typeof productData.batchNumber === "string" && productData.batchNumber.trim()) 
                ? productData.batchNumber.trim() 
                : "BATCH-001";
            const incomingQty = Math.max(0, Number(productData.quantity ?? productData.qty ?? 0));
            const incomingExpDate = productData.expDate || null;
            const incomingBuyingPrice = Math.max(0, Number(productData.buyingPrice ?? existingProduct.buyingPrice ?? 0));
            const incomingSellingPrice = Math.max(0, Number(productData.sellingPrice ?? productData.price ?? existingProduct.sellingPrice ?? 0));

            // Check if this batch already exists for this product in this store
            let targetBatch = await Batch.findOne({
                productId: existingProduct._id,
                store: productData.store,
                batchNumber: incomingBatchNumber
            });

            if (targetBatch) {
                // Batch is THE SAME: Add entered quantity to initial quantity
                const initialQty = Number(targetBatch.quantity || 0);
                targetBatch.quantity = initialQty + incomingQty;

                if (incomingExpDate) {
                    targetBatch.expiryDate = incomingExpDate;
                }
                if (incomingSellingPrice > 0) {
                    targetBatch.sellingPrice = incomingSellingPrice;
                }
                if (incomingBuyingPrice > 0) {
                    targetBatch.buyingPrice = incomingBuyingPrice;
                }
                if (targetBatch.isArchived && targetBatch.quantity > 0) {
                    targetBatch.isArchived = false;
                }
                await targetBatch.save();
                console.log(`[PRODUCT SERVICE] Existing batch "${incomingBatchNumber}" updated: ${initialQty} + ${incomingQty} = ${targetBatch.quantity}`);
            } else {
                // Batch is DIFFERENT: Create new batch under this product
                targetBatch = await Batch.create({
                    productId: existingProduct._id,
                    store: productData.store,
                    batchNumber: incomingBatchNumber,
                    expiryDate: incomingExpDate,
                    manufacturingDate: productData.manufacturingDate || null,
                    quantity: incomingQty,
                    buyingPrice: incomingBuyingPrice,
                    sellingPrice: incomingSellingPrice,
                    createdBy: productData.createdBy || existingProduct.createdBy || null,
                    isArchived: incomingQty === 0,
                });
                console.log(`[PRODUCT SERVICE] New batch "${incomingBatchNumber}" created for product ${existingProduct._id} with qty ${incomingQty}`);
            }

            // Keep Product.quantity & Inventory.quantity in sync with sum of all active batches
            const totalQty = await syncProductQuantity(existingProduct._id, productData.store);

            // Update product's active batch number, expDate, prices, and quantity
            existingProduct.quantity = totalQty;
            existingProduct.batchNumber = incomingBatchNumber;
            if (incomingSellingPrice > 0) existingProduct.sellingPrice = incomingSellingPrice;
            if (incomingBuyingPrice > 0) existingProduct.buyingPrice = incomingBuyingPrice;
            if (incomingExpDate) existingProduct.expDate = incomingExpDate;
            await existingProduct.save();

            const allBatches = await Batch.find({
                productId: existingProduct._id,
                store: productData.store
            }).sort({ isArchived: 1, expiryDate: 1 }).lean();

            return {
                ...existingProduct.toObject(),
                batchNumber: incomingBatchNumber,
                batches: allBatches,
            };
        }

        // 3. Brand new product (no existing barcode or name)
        if (productData.batchNumber && typeof productData.batchNumber === "string" && productData.batchNumber.trim()) {
            productData.batchNumber = productData.batchNumber.trim();
        } else {
            productData.batchNumber = "BATCH-001";
        }

        const product = await Product.create(productData);

        // Automatically create the initial Batch for this new product
        try {
            await createFirstBatch({
                productId: product._id,
                storeId: product.store,
                createdBy: product.createdBy,
                quantity: productData.quantity ?? productData.qty ?? 0,
                buyingPrice: productData.buyingPrice ?? 0,
                sellingPrice: productData.sellingPrice ?? productData.price ?? 0,
                expiryDate: productData.expDate ?? null,
                batchNumber: productData.batchNumber?.trim() || null,
            });
            console.log(`[PRODUCT SERVICE] Initial batch created for product ${product._id}`);
        } catch (batchErr) {
            console.error('[PRODUCT SERVICE] First batch creation failed:', batchErr.message);
        }

        return product;
    } catch (error) {
        throw error;
    }
};

//get product by id service (store-scoped when storeId provided)
export const getProductById = async (productId, storeId = null) => {
    try {
        let product;
        if (storeId) {
            product = await Product.findOne({ _id: productId, store: storeId }).lean();
        } else {
            product = await Product.findById(productId).lean();
        }
        if (!product) {
            throw new ApiError("Product not found", 404);
        }
        const effectiveStoreId = storeId || product.store;
        const batches = await Batch.find({ productId: product._id, store: effectiveStoreId })
            .sort({ isArchived: 1, expiryDate: 1 })
            .lean();
        const activeBatch = batches.find(b => !b.isArchived) || batches[0];
        return {
            ...product,
            batchNumber: activeBatch?.batchNumber || product.batchNumber || "BATCH-001",
            batches
        };
    } catch (error) {
        throw error;
    }
};

//update product by id service (store-scoped when storeId provided)
export const updateProductById = async (productId, productData, storeId = null) => {
    try {
        let product;
        if (storeId) {
            product = await Product.findOne({ _id: productId, store: storeId });
        } else {
            product = await Product.findById(productId);
        }
        if (!product) {
            throw new ApiError("Product not found", 404);
        }
        if (productData.addQuantity !== undefined && productData.addQuantity !== null) {
            const delta = Number(productData.addQuantity) || 0;
            product.quantity = Math.max(0, (product.quantity || 0) + delta);
            delete productData.addQuantity;
            delete productData.quantity;
        } else if (productData.quantityDelta !== undefined && productData.quantityDelta !== null) {
            const delta = Number(productData.quantityDelta) || 0;
            product.quantity = Math.max(0, (product.quantity || 0) + delta);
            delete productData.quantityDelta;
            delete productData.quantity;
        }
        // Protect against changing store ownership
        delete productData.store;

        // Synchronize batchNumber on Product and Batch documents
        if (productData.batchNumber && typeof productData.batchNumber === "string" && productData.batchNumber.trim()) {
            const newBn = productData.batchNumber.trim();
            productData.batchNumber = newBn;
            product.batchNumber = newBn;

            try {
                const batch = await Batch.findOne({ productId: product._id }).sort({ isArchived: 1, createdAt: 1 });
                if (batch) {
                    batch.batchNumber = newBn;
                    await batch.save();
                } else {
                    await Batch.create({
                        productId: product._id,
                        store: product.store,
                        batchNumber: newBn,
                        expiryDate: product.expDate || null,
                        quantity: Math.max(0, Number(product.quantity) || 0),
                        buyingPrice: Math.max(0, Number(product.buyingPrice) || 0),
                        sellingPrice: Math.max(0, Number(product.sellingPrice) || 0),
                        createdBy: product.createdBy || null,
                    });
                }
            } catch (bErr) {
                console.warn("[PRODUCT SERVICE] Batch sync on update skipped:", bErr.message);
            }
        }

        product.set(productData);
        await product.save();
        return product;
    } catch (error) {
        throw error;
    }
};

//delete product by id service (store-scoped when storeId provided)
export const deleteProductById = async (productId, storeId = null) => {
    try {
        let product;
        if (storeId) {
            product = await Product.findOne({ _id: productId, store: storeId });
        } else {
            product = await Product.findById(productId);
        }
        if (!product) {
            throw new ApiError("Product not found", 404);
        }
        product.isActive = false;
        await product.save();
        return product;
    } catch (error) {
        throw error;
    }
};

//get all products service (with batches attached)
export const getAllProducts = async (storeId) => {
    try {
        if (!storeId) {
            throw new ApiError("Store ID is required to fetch products", 400);
        }

        const products = await Product.find({
            store: storeId,
            isActive: true
        }).populate("store", "name").populate("createdBy", "name email").lean();

        // Fetch batches for all products in this store
        const productIds = products.map(p => p._id);
        const batches = await Batch.find({
            store: storeId,
            productId: { $in: productIds }
        }).sort({ isArchived: 1, expiryDate: 1 }).lean();

        // Group batches by productId
        const batchMap = {};
        for (const b of batches) {
            const pId = b.productId.toString();
            if (!batchMap[pId]) batchMap[pId] = [];
            batchMap[pId].push(b);
        }

        // Attach batches array to each product and ensure batchNumber reflects real batch
        return products.map(prod => {
            const prodBatches = batchMap[prod._id.toString()] || [];
            const activeBatch = prodBatches.find(b => !b.isArchived) || prodBatches[0];
            const resolvedBatchNumber = activeBatch?.batchNumber || prod.batchNumber || "BATCH-001";
            return {
                ...prod,
                batchNumber: resolvedBatchNumber,
                batches: prodBatches
            };
        });
    } catch (error) {
        throw error;
    }
};

//get product by barcode service (store-scoped with batches attached)
export const getProductByBarcode = async (barcode, storeId) => {
    try {
        if (!barcode) {
            throw new ApiError("Barcode is required", 400);
        }

        if (!storeId) {
            throw new ApiError("Store ID is required for barcode lookup", 400);
        }

        const product = await Product.findOne({
            barcode: barcode.trim(),
            store: storeId,
            isActive: true
        }).populate("store", "name").lean();

        if (!product) return null;

        const batches = await Batch.find({
            store: storeId,
            productId: product._id
        }).sort({ isArchived: 1, expiryDate: 1 }).lean();

        const activeBatch = batches.find(b => !b.isArchived) || batches[0];
        return {
            ...product,
            batchNumber: activeBatch?.batchNumber || product.batchNumber || "BATCH-001",
            batches
        };
    } catch (error) {
        throw error;
    }
};

// Search products by name or barcode within a specific store (with batches attached)
export const searchProductsInStore = async (query, storeId) => {
    try {
        if (!storeId) {
            throw new ApiError("Store reference is required", 400);
        }

        if (!query || query.trim() === "") {
            return [];
        }

        const trimmed = query.trim();
        const searchRegex = new RegExp(trimmed, 'i');

        const products = await Product.find({
            store: storeId,
            isActive: true,
            $or: [
                { name: searchRegex },
                { barcode: searchRegex },
                { category: searchRegex }
            ]
        }).limit(20).lean();

        const productIds = products.map(p => p._id);
        const batches = await Batch.find({
            store: storeId,
            productId: { $in: productIds }
        }).sort({ isArchived: 1, expiryDate: 1 }).lean();

        const batchMap = {};
        for (const b of batches) {
            const pId = b.productId.toString();
            if (!batchMap[pId]) batchMap[pId] = [];
            batchMap[pId].push(b);
        }

        return products.map(prod => {
            const prodBatches = batchMap[prod._id.toString()] || [];
            const activeBatch = prodBatches.find(b => !b.isArchived) || prodBatches[0];
            return {
                ...prod,
                batchNumber: activeBatch?.batchNumber || prod.batchNumber || "BATCH-001",
                batches: prodBatches
            };
        });
    } catch (error) {
        throw error;
    }
};

// MasterProduct: lookup by barcode (shared catalog across stores)
export const getMasterProduct = async (barcode) => {
    try {
        if (!barcode || typeof barcode !== "string" || barcode.trim() === "") {
            throw new ApiError("Barcode is required", 400);
        }

        const masterProduct = await MasterProduct.findOne({ barcode: barcode.trim() });
        return masterProduct;
    } catch (error) {
        throw error;
    }
};

// MasterProduct: save a product to the master catalog (idempotent — won't overwrite existing)
export const saveMasterProduct = async (productData) => {
    try {
        if (!productData || !productData.barcode || typeof productData.barcode !== "string" || productData.barcode.trim() === "") {
            throw new ApiError("Barcode is required to save to master catalog", 400);
        }

        const barcode = productData.barcode.trim();

        const existing = await MasterProduct.findOne({ barcode });
        if (existing) {
            return { saved: false, product: existing };
        }

        const normalized = normalizeProduct(productData);

        const newMasterProduct = await MasterProduct.create({
            barcode,
            name: normalized.name,
            category: normalized.category,
            brand: normalized.brand || null,
            description: normalized.description || null,
            imageUrl: normalized.imageUrl || null,
            source: normalized.source || "user-submitted",
            confidenceScore: normalized.confidenceScore || 0.5,
            rawMetadata: productData
        });

        return { saved: true, product: newMasterProduct };
    } catch (error) {
        throw error;
    }
};

// Get a product with all its batches (for existing-barcode modal)
export const getProductWithBatches = async (barcode, storeId) => {
    try {
        if (!barcode || !storeId) {
            throw new ApiError("Barcode and storeId are required", 400);
        }

        const product = await Product.findOne({
            barcode: barcode.trim(),
            store: storeId,
            isActive: true,
        });

        if (!product) return null;

        const batches = await getAllBatchesByProduct(product._id, storeId);

        return { product, batches };
    } catch (error) {
        throw error;
    }
};
