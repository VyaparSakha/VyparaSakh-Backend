import { addProduct, getProductById, updateProductById, deleteProductById, getAllProducts, getProductByBarcode, getMasterProduct, saveMasterProduct, searchProductsInStore, getProductWithBatches } from "./product.service.js";
import { resolveBarcode } from "./resolver.service.js";
import { ApiResponse } from "../../utils/ApiResponse.js";
import { uploadBufferToCloudinary } from "../../utils/cloudinary.js";

const cleanStoreId = (s) => {
  if (!s) return "";
  if (typeof s === "object") {
    const extracted = s._id || s.id || "";
    return typeof extracted === "string" ? extracted.trim() : "";
  }
  const str = String(s).trim();
  if (str === "undefined" || str === "null" || str === "[object Object]") return "";
  return str;
};

// Search products controller
export const searchProductsController = async (req, res) => {
    try {
        const query = req.query?.query;
        const rawStore = req.query?.storeId || req.headers?.["x-store-id"];
        const storeId = cleanStoreId(rawStore);
        const products = await searchProductsInStore(query, storeId);
        res.status(200).json(new ApiResponse(products, "Products searched successfully", 200));
    } catch (error) {
        res.status(error.statusCode || 500).json(new ApiResponse(null, error.message, error.statusCode || 500));
    }
};

//create product controller
export const addProductController = async (req, res) => {
    try {
        const rawStore = req.body?.storeId || req.body?.store || req.headers?.["x-store-id"];
        const productData = {
            ...req.body,
            store: cleanStoreId(rawStore),
            createdBy: req.user?._id
        };

        const product = await addProduct(productData);
        res.status(201).json(new ApiResponse(product, "Product created successfully", 201));
    } catch (error) {
        res.status(error.statusCode || 500).json(new ApiResponse(null, error.message, error.statusCode || 500));
    }
};

//get product by id controller
export const getProductController = async (req, res) => {
    try {
        const storeId = req.query?.storeId || req.headers?.["x-store-id"];
        const product = storeId
            ? await getProductById(req.params.id, storeId)
            : await getProductById(req.params.id);
        res.status(200).json(new ApiResponse(product, "Product fetched successfully", 200));
    } catch (error) {
        res.status(error.statusCode || 500).json(new ApiResponse(null, error.message, error.statusCode || 500));
    }
};

//update product by id controller
export const updateProductController = async (req, res) => {
    try {
        const storeId = req.query?.storeId || req.body?.storeId || req.headers?.["x-store-id"];
        const product = storeId
            ? await updateProductById(req.params.id, req.body, storeId)
            : await updateProductById(req.params.id, req.body);
        res.status(200).json(new ApiResponse(product, "Product updated successfully", 200));
    } catch (error) {
        res.status(error.statusCode || 500).json(new ApiResponse(null, error.message, error.statusCode || 500));
    }
};

//delete product by id controller
export const deleteProductController = async (req, res) => {
    try {
        const storeId = req.query?.storeId || req.headers?.["x-store-id"];
        const product = storeId
            ? await deleteProductById(req.params.id, storeId)
            : await deleteProductById(req.params.id);
        res.status(200).json(new ApiResponse(product, "Product deleted successfully", 200));
    } catch (error) {
        res.status(error.statusCode || 500).json(new ApiResponse(null, error.message, error.statusCode || 500));
    }
};

//get all products controller
export const getAllProductsController = async (req, res) => {
    try {
        const rawStore = req.query?.storeId || req.headers?.["x-store-id"];
        const storeId = cleanStoreId(rawStore);
        const products = await getAllProducts(storeId);
        res.status(200).json(new ApiResponse(products, "Products fetched successfully", 200));
    } catch (error) {
        res.status(error.statusCode || 500).json(new ApiResponse(null, error.message, error.statusCode || 500));
    }
};

// Resolve a product globally by barcode (public, no auth required)
// GET /api/products/resolve/:barcode
export const resolveProduct = async (req, res) => {
    try {
        const { barcode } = req.params;

        const result = await resolveBarcode(barcode);

        if (!result) {
            return res.status(404).json({
                success: false,
                message: "Product not found for this barcode.",
            });
        }

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

// Lookup a product by barcode within a specific store (authenticated)
// GET /api/product/barcode/:barcode?storeId=...
export const getProductByBarcodeController = async (req, res) => {
    try {
        const { barcode } = req.params;
        const rawStore = req.query?.storeId || req.headers?.["x-store-id"];
        const storeId = cleanStoreId(rawStore);

        const product = await getProductByBarcode(barcode, storeId);

        if (!product) {
            return res.status(404).json(new ApiResponse(null, "Product not found with this barcode", 404));
        }

        return res.status(200).json(new ApiResponse(product, "Product found", 200));
    } catch (error) {
        return res.status(error.statusCode || 500).json(
            new ApiResponse(null, error.message || "Failed to fetch product by barcode.", error.statusCode || 500)
        );
    }
};

// MasterProduct: lookup by barcode from the shared catalog (authenticated)
// GET /api/product/master/:barcode
export const getMasterProductController = async (req, res) => {
    try {
        const { barcode } = req.params;

        const masterProduct = await getMasterProduct(barcode);

        if (!masterProduct) {
            return res.status(404).json({
                success: false,
                message: "Barcode not found in master catalog.",
            });
        }

        return res.status(200).json({
            success: true,
            data: masterProduct,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to lookup barcode in master catalog.",
        });
    }
};

// MasterProduct: save a manually-entered product to the shared catalog (authenticated, idempotent)
// POST /api/product/master
export const saveMasterProductController = async (req, res) => {
    try {
        const productData = req.body;

        const result = await saveMasterProduct(productData);

        return res.status(result.saved ? 201 : 200).json({
            success: true,
            message: result.saved
                ? "Product added to master catalog."
                : "Barcode already exists in master catalog.",
            data: result.product,
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to save product to master catalog.",
        });
    }
};

//upload product image controller
export const uploadProductImageController = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json(new ApiResponse(null, "No image file provided", 400));
        }

        const uploadedImage = await uploadBufferToCloudinary(req.file.buffer, {
            folder: "vyapar-sathi/products",
        });

        return res.status(200).json(
            new ApiResponse(
                {
                    url: uploadedImage.secure_url,
                    publicId: uploadedImage.public_id,
                },
                "Image uploaded successfully",
                200
            )
        );
    } catch (error) {
        return res.status(error.statusCode || 500).json(
            new ApiResponse(null, error.message || "Image upload failed", error.statusCode || 500)
        );
    }
};

// Get product details + all batches for a barcode (for existing-barcode modal)
// GET /api/product/barcode/:barcode/details?storeId=...
export const getProductWithBatchesController = async (req, res) => {
    try {
        const { barcode } = req.params;
        const storeId = req.query?.storeId || req.headers?.["x-store-id"];

        const result = await getProductWithBatches(barcode, storeId);

        if (!result) {
            return res.status(404).json(new ApiResponse(null, "Product not found with this barcode", 404));
        }

        return res.status(200).json(new ApiResponse(result, "Product with batches fetched successfully", 200));
    } catch (error) {
        return res.status(error.statusCode || 500).json(
            new ApiResponse(null, error.message || "Failed to fetch product with batches.", error.statusCode || 500)
        );
    }
};
