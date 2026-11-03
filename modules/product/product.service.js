import { Product, MasterProduct } from '../../models/index.js';
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

        // Check for duplicate name in the same store
        const existingByName = await Product.findOne({
            store: productData.store,
            name: { $regex: new RegExp(`^${productData.name}$`, 'i') },
            isActive: true
        });

        if (existingByName) {
            throw new ApiError(`A product with the name "${productData.name}" already exists in this store.`, 409);
        }

        // Check for duplicate barcode in the same store (only if barcode is provided)
        if (productData.barcode && productData.barcode.trim() !== "") {
            const existingByBarcode = await Product.findOne({
                store: productData.store,
                barcode: productData.barcode,
                isActive: true
            });

            if (existingByBarcode) {
                throw new ApiError(`A product with barcode "${productData.barcode}" already exists in this store (Product: ${existingByBarcode.name}).`, 409);
            }
        }

        const product = await Product.create(productData);
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
            product = await Product.findOne({ _id: productId, store: storeId });
        } else {
            product = await Product.findById(productId);
        }
        if (!product) {
            throw new ApiError("Product not found", 404);
        }
        return product;
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

//get all products service
export const getAllProducts = async (storeId) => {
    try {
        if (!storeId) {
            throw new ApiError("Store ID is required to fetch products", 400);
        }

        const products = await Product.find({
            store: storeId,
            isActive: true
        }).populate("store", "name").populate("createdBy", "name email");

        return products;
    } catch (error) {
        throw error;
    }
};

//get product by barcode service (store-scoped)
export const getProductByBarcode = async (barcode, storeId) => {
    try {
        if (!barcode) {
            throw new ApiError("Barcode is required", 400);
        }

        if (!storeId) {
            throw new ApiError("Store ID is required for barcode lookup", 400);
        }

        const query = Product.findOne({
            barcode: barcode.trim(),
            store: storeId,
            isActive: true
        });

        const product = query && typeof query.populate === "function"
            ? await query.populate("store", "name")
            : await query;

        return product;
    } catch (error) {
        throw error;
    }
};

// Search products by name or barcode within a specific store
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
        }).limit(20);

        return products;
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
