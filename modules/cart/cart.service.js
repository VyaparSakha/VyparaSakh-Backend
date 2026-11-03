import { Cart } from "../../models/index.js";
import { Product } from "../../models/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { assertCartAccess } from "../store/storeAccess.service.js";
import { materializeSaleFromCart } from "../sale/sale.service.js";

export const createCart = async (cartData) => {
  try {
    if (!cartData.user || !cartData.store) {
      throw new ApiError("User and Store references are required", 400);
    }

    let cart = await Cart.findOne({
      user: cartData.user,
      store: cartData.store,
      status: { $in: ["open", "scanning"] },
    });

    if (cart) {
      cart.products = [];
      cart.totalPrice = 0;
      cart.subtotal = 0;
      cart.discount = { type: "fixed", value: 0, amount: 0 };
      cart.status = "open";
      cart.paymentStatus = "pending";
      await cart.save();
      return cart;
    }

    cart = await Cart.create(cartData);
    if (!cart) {
      throw new ApiError("Failed to create cart", 400);
    }
    return cart;
  } catch (error) {
    throw error;
  }
};

export const startScanning = async (cartId) => {
  const cart = await Cart.findByIdAndUpdate(
    cartId,
    { status: "scanning" },
    { new: true },
  );
  if (!cart) throw new ApiError("Cart not found", 404);
  return cart;
};

export const addItemToCart = async (cartId, productId, quantity = 1) => {
  const cart = await Cart.findById(cartId);
  if (!cart) throw new ApiError("Cart not found", 404);
  if (cart.status !== "scanning" && cart.status !== "open") {
    throw new ApiError("Cannot add items to cart in current status", 400);
  }

  // Cross-tenant data isolation: Product must belong to the cart's store
  const product = await Product.findOne({ _id: productId, store: cart.store });
  if (!product) throw new ApiError("Product not found in this store", 404);
  if (product.quantity < quantity)
    throw new ApiError("Insufficient stock", 400);

  const productPrice = Number(product.sellingPrice ?? product.price ?? 0);

  const itemIndex = cart.products.findIndex(
    (p) => p.product.toString() === productId,
  );

  if (itemIndex > -1) {
    cart.products[itemIndex].quantity += quantity;
    cart.products[itemIndex].price = productPrice;
  } else {
    cart.products.push({
      product: productId,
      quantity,
      price: productPrice,
    });
  }

  // Recalculate total price safely
  cart.totalPrice = cart.products.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );

  await cart.save();
  return cart;
};

export const processPayment = async (
  cartId,
  paymentMethod,
  amountPaid,
  metadata = {},
) => {
  const cart = await Cart.findById(cartId);
  if (!cart) throw new ApiError("Cart not found", 404);
  if (cart.status === "completed") {
    throw new ApiError("Cart is already completed", 400);
  }

  cart.paymentMethod = paymentMethod;
  cart.amountPaid = amountPaid;
  cart.paymentStatus = "paid";
  cart.paymentMetadata = metadata;

  await cart.save();
  return cart;
};

export const confirmPayment = async (cartId, userId) => {
  console.log(`[CART SERVICE] Confirming payment for cart=${cartId}`);

  if (!userId) {
    throw new ApiError(
      "User not registered. Please complete registration first.",
      403,
    );
  }

  const cart = await assertCartAccess(cartId, userId);

  if (cart.paymentStatus !== "paid") {
    throw new ApiError("Payment hasn't been made yet", 400);
  }

  const result = await materializeSaleFromCart(cartId, userId);
  console.log(
    `[CART SERVICE] Payment confirmation completed for cart=${cartId} saleCreated=${Boolean(result.sale)}`,
  );

  return result.cart;
};

export const getProductByBarcodeInCart = async (cartId, barcode) => {
  const cart = await Cart.findById(cartId);
  if (!cart) throw new ApiError("Cart not found", 404);

  const product = await Product.findOne({
    store: cart.store,
    barcode: barcode,
    isActive: true,
  });

  if (!product) {
    throw new ApiError(
      "Product not found in this store with this barcode",
      404,
    );
  }

  return product;
};

export const getBillHistory = async (storeId, limit = 50, page = 1, filters = {}) => {
  try {
    if (!storeId) {
      throw new ApiError("Store ID is required", 400);
    }

    const { date, month, year } = filters;
    const query = {
      store: storeId,
      status: "completed",
      paymentStatus: "paid",
    };

    // Apply date filters
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.updatedAt = { $gte: start, $lte: end };
    } else if (month && year) {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);
      query.updatedAt = { $gte: start, $lte: end };
    } else if (year) {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      query.updatedAt = { $gte: start, $lte: end };
    }

    const skip = (page - 1) * limit;

    const bills = await Cart.find(query)
      .populate("products.product", "name price sellingPrice buyingPrice")
      .populate("user", "name email")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Cart.countDocuments(query);

    return {
      bills,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    throw error;
  }
};
