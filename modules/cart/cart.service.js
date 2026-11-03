import { Cart } from "../../models/index.js";
import { Product } from "../../models/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { assertCartAccess, assertStoreOwner } from "../store/storeAccess.service.js";
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


/**
 * Optimized Single-Trip Checkout
 * Handles item validation, cart session, payment, and inventory update in ONE atomic step.
 */
export const quickCheckout = async (userId, checkoutData) => {
  if (!userId) {
    throw new ApiError("User not registered. Please complete registration first.", 403);
  }

  const {
    storeId,
    products,
    paymentMethod = "cash",
    subtotal,
    discount,
    totalAmount,
    buyerId,
    customerName,
    customerPhone,
    customerEmail,
  } = checkoutData;

  if (!storeId || !products || !Array.isArray(products) || !products.length) {
    throw new ApiError("Store and products are required for checkout", 400);
  }

  // Verify access to store
  await assertStoreOwner(storeId, userId);

  // Fetch all products in ONE single batch query
  const productIds = products.map((p) => p._id || p.productId);
  const dbProducts = await Product.find({ _id: { $in: productIds } });
  const productMap = new Map(dbProducts.map((p) => [p._id.toString(), p]));

  // Build cart items array
  const cartProducts = [];
  let calculatedSubtotal = 0;

  for (const item of products) {
    const pId = String(item._id || item.productId);
    const product = productMap.get(pId);
    if (!product) {
      throw new ApiError(`Product not found: ${item.name || pId}`, 404);
    }

    const qty = Number(item.billedQuantity || item.quantity || 1);
    if (product.quantity < qty) {
      throw new ApiError(
        `Insufficient stock for "${product.name}". Available: ${product.quantity}, Requested: ${qty}`,
        400,
      );
    }

    const price = Number(product.sellingPrice ?? product.price ?? item.price ?? 0);
    cartProducts.push({
      product: product._id,
      quantity: qty,
      price,
    });
    calculatedSubtotal += price * qty;
  }

  // Reuse open cart or create a new cart
  let cart = await Cart.findOne({
    user: userId,
    store: storeId,
    status: { $in: ["open", "scanning"] },
  });

  if (!cart) {
    cart = new Cart({
      user: userId,
      store: storeId,
    });
  }

  const finalSubtotal = subtotal !== undefined ? Number(subtotal) : calculatedSubtotal;
  const finalDiscount = discount || { type: "fixed", value: 0, amount: 0 };
  const finalTotal =
    totalAmount !== undefined
      ? Number(totalAmount)
      : Math.max(0, finalSubtotal - (Number(finalDiscount.amount) || 0));

  cart.products = cartProducts;
  cart.subtotal = finalSubtotal;
  cart.discount = finalDiscount;
  cart.totalPrice = finalTotal;
  cart.paymentId = `${paymentMethod}-${Date.now()}`;
  cart.paymentMethod = paymentMethod;
  cart.paymentStatus = "paid";
  cart.status = "payment_pending";
  cart.buyer = buyerId || null;
  cart.customerName = customerName || "Walk-in Customer";
  cart.customerPhone = customerPhone || "";
  cart.customerEmail = customerEmail || "";

  await cart.save();

  // Finalize sale and inventory automatically
  const result = await materializeSaleFromCart(cart._id, userId);

  return {
    ...(result.cart.toObject ? result.cart.toObject() : result.cart),
    saleId: result.sale?._id,
    billNumber: result.sale?.billNumber || result.cart?.billNumber,
  };
};

