import { jest } from "@jest/globals";

const mockProductFindByIdAndUpdate = jest.fn();
const mockProductFind = jest.fn();
const mockSaleFindOne = jest.fn();
const mockSaleCreate = jest.fn();
const mockStoreFindById = jest.fn();
const mockInventoryFindOne = jest.fn();
const mockAssertCartAccess = jest.fn();
const mockSendLowStockNotificationEmail = jest.fn();

jest.unstable_mockModule("../../../models/index.js", () => ({
  Product: {
    findByIdAndUpdate: mockProductFindByIdAndUpdate,
    find: mockProductFind,
  },
  Sale: {
    findOne: mockSaleFindOne,
    create: mockSaleCreate,
  },
  Store: {
    findById: mockStoreFindById,
  },
  Inventory: {
    findOne: mockInventoryFindOne,
  },
  Buyer: {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  },
  Notification: {
    find: jest.fn(),
    create: jest.fn(),
  },
}));

jest.unstable_mockModule("../../../utils/mailer.js", () => ({
  sendLowStockNotificationEmail: mockSendLowStockNotificationEmail,
  sendInvoiceEmail: jest.fn(),
}));

jest.unstable_mockModule(
  "../../../modules/store/storeAccess.service.js",
  () => ({
    assertCartAccess: mockAssertCartAccess,
  })
);

const { materializeSaleFromCart } = await import(
  "../../../modules/sale/sale.service.js"
);

const buildCart = (overrides = {}) => ({
  _id: "cart-1",
  store: "store-1",
  user: "user-1",
  paymentId: "cash-123",
  paymentStatus: "paid",
  status: "payment_pending",
  products: [
    {
      product: {
        _id: "prod-1",
        name: "Chips",
        category: "Snacks",
        quantity: 10,
        sellingPrice: 20,
        buyingPrice: 15,
        isActive: true,
      },
      quantity: 2,
      price: 20,
    },
  ],
  totalPrice: 40,
  subtotal: 40,
  tax: { amount: 0 },
  discount: { amount: 0 },
  appliedCoupons: [],
  customer: {
    name: "Walk-in Customer",
    phone: "9999999999",
  },
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

describe("sale.service.materializeSaleFromCart", () => {
  beforeEach(() => {
    mockProductFindByIdAndUpdate.mockReset();
    mockProductFind.mockReset();
    mockSaleFindOne.mockReset();
    mockSaleCreate.mockReset();
    mockStoreFindById.mockReset();
    mockInventoryFindOne.mockReset();
    mockAssertCartAccess.mockReset();
    mockSendLowStockNotificationEmail.mockReset();
  });

  test("materializes sale and updates inventory for paid cart", async () => {
    const cart = buildCart();
    mockAssertCartAccess.mockResolvedValue(cart);
    mockSaleFindOne.mockResolvedValue(null);
    mockSaleCreate.mockResolvedValue({ _id: "sale-1", ...cart });
    mockStoreFindById.mockResolvedValue({
      _id: "store-1",
      settings: { lowStockThreshold: 5 },
      email: "store@example.com",
    });

    const result = await materializeSaleFromCart("cart-1", "user-1");

    expect(mockAssertCartAccess).toHaveBeenCalledWith("cart-1", "user-1", "products.product");
    expect(mockSaleCreate).toHaveBeenCalled();
    expect(result.cart.status).toBe("completed");
    expect(result.sale).toBeDefined();
  });

  test("returns existing sale if already materialized", async () => {
    const cart = buildCart({ status: "completed" });
    const existingSale = { _id: "sale-existing", cart: "cart-1" };
    mockAssertCartAccess.mockResolvedValue(cart);
    mockSaleFindOne.mockResolvedValue(existingSale);

    const result = await materializeSaleFromCart("cart-1", "user-1");

    expect(result.sale).toBe(existingSale);
    expect(mockSaleCreate).not.toHaveBeenCalled();
  });

  test("throws if product in cart is inactive", async () => {
    const cart = buildCart({
      products: [
        {
          product: {
            _id: "prod-1",
            name: "Inactive Item",
            isActive: false,
          },
          quantity: 1,
        },
      ],
    });
    mockAssertCartAccess.mockResolvedValue(cart);

    await expect(materializeSaleFromCart("cart-1", "user-1")).rejects.toThrow(
      'Product "Inactive Item" is inactive'
    );
  });

  test("throws if insufficient stock", async () => {
    const cart = buildCart({
      products: [
        {
          product: {
            _id: "prod-1",
            name: "Low Stock Item",
            quantity: 1,
            isActive: true,
          },
          quantity: 5,
        },
      ],
    });
    mockAssertCartAccess.mockResolvedValue(cart);

    await expect(materializeSaleFromCart("cart-1", "user-1")).rejects.toThrow(
      'Insufficient stock for "Low Stock Item"'
    );
  });
});
