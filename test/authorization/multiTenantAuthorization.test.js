import { jest } from "@jest/globals";
import mongoose from "mongoose";

// Setup mocks for models
const mockStoreFind = jest.fn();
const mockStoreFindById = jest.fn();
const mockStoreFindOne = jest.fn();
const mockStoreCountDocuments = jest.fn();

const mockEmployeeFind = jest.fn();
const mockEmployeeFindOne = jest.fn();
const mockEmployeeCountDocuments = jest.fn();

const mockRoleFind = jest.fn();
const mockRoleFindOne = jest.fn();

const mockProductFind = jest.fn();
const mockProductFindById = jest.fn();
const mockProductFindOne = jest.fn();

const mockCartFindById = jest.fn();

jest.unstable_mockModule("../../models/index.js", () => ({
  Store: {
    find: mockStoreFind,
    findById: mockStoreFindById,
    findOne: mockStoreFindOne,
    countDocuments: mockStoreCountDocuments,
  },
  Employee: {
    find: mockEmployeeFind,
    findOne: mockEmployeeFindOne,
    countDocuments: mockEmployeeCountDocuments,
  },
  Role: {
    find: mockRoleFind,
    findOne: mockRoleFindOne,
  },
  Product: {
    find: mockProductFind,
    findById: mockProductFindById,
    findOne: mockProductFindOne,
  },
  MasterProduct: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  Cart: {
    findById: mockCartFindById,
  },
  Sale: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  Inventory: {
    findOne: jest.fn(),
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
  Invitation: {
    find: jest.fn(() => ({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    })),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  User: {
    findOne: jest.fn(),
  },
}));

jest.unstable_mockModule("../../utils/mailer.js", () => ({
  sendLowStockNotificationEmail: jest.fn(),
  sendInvoiceEmail: jest.fn(),
  sendInviteEmail: jest.fn().mockResolvedValue(true),
}));

const { default: requirePermission } = await import(
  "../../middlewares/requirePermission.middleware.js"
);
const { default: requireOwner } = await import(
  "../../middlewares/requireOwner.middleware.js"
);
const { resolveStoreContextForUser } = await import(
  "../../middlewares/resolveStoreContext.middleware.js"
);
const { requireStoreCreationEligibility } = await import(
  "../../middlewares/storePolicy.middleware.js"
);
const { getUserWorkspaces } = await import(
  "../../modules/me/me.service.js"
);
const { getProductById } = await import(
  "../../modules/product/product.service.js"
);
const { addItemToCart } = await import(
  "../../modules/cart/cart.service.js"
);
const { ALL_PERMISSIONS, PERMISSIONS } = await import(
  "../../utils/permissions.js"
);

describe("Multi-Tenant Identity, Workspace Resolution, and Authorization", () => {
  const storeAId = new mongoose.Types.ObjectId().toString();
  const storeBId = new mongoose.Types.ObjectId().toString();

  const userRahulId = new mongoose.Types.ObjectId().toString();
  const userAmitId = new mongoose.Types.ObjectId().toString();
  const userPriyaId = new mongoose.Types.ObjectId().toString();
  const userNewId = new mongoose.Types.ObjectId().toString();

  const roleCashierStoreAId = new mongoose.Types.ObjectId().toString();
  const roleManagerStoreAId = new mongoose.Types.ObjectId().toString();
  const roleStoreBId = new mongoose.Types.ObjectId().toString();

  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  // ─── CASE 1: Owner can access their own store ──────────────────────────────
  test("Case 1: Owner can access their own store with full permissions", async () => {
    const storeA = {
      _id: storeAId,
      name: "Rahul Store",
      owner: userRahulId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeA);

    req = {
      params: { storeId: storeAId },
      user: { _id: userRahulId },
    };

    const middleware = requirePermission("billing:create");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userRole).toBe("owner");
    expect(req.authContext.isOwner).toBe(true);
    expect(req.authContext.membershipType).toBe("owner");
    expect(req.authContext.permissions).toEqual(ALL_PERMISSIONS);
  });

  // ─── CASE 2: Owner cannot access another person's store without membership ─
  test("Case 2: Owner cannot access another person's store without membership", async () => {
    const storeB = {
      _id: storeBId,
      name: "Priya Boutique",
      owner: userPriyaId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeB);

    // Rahul has no employee record in Store B
    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    req = {
      params: { storeId: storeBId },
      user: { _id: userRahulId },
    };

    const middleware = requirePermission("billing:create");
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Access Denied: You do not have permission to access this store.",
        statusCode: 403,
      })
    );
  });

  // ─── CASE 3: Active employee can access an assigned store ───────────────────
  test("Case 3: Active employee can access an assigned store with permitted action", async () => {
    const storeA = {
      _id: storeAId,
      name: "Rahul Store",
      owner: userRahulId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeA);

    const activeCashierEmployee = {
      _id: "emp-amit-1",
      store: storeAId,
      user: userAmitId,
      status: "active",
      role: {
        _id: roleCashierStoreAId,
        name: "Cashier",
        store: storeAId,
        permissions: ["billing:create"],
      },
    };

    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(activeCashierEmployee),
    });

    req = {
      params: { storeId: storeAId },
      user: { _id: userAmitId },
    };

    const middleware = requirePermission("billing:create");
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userRole).toBe("Cashier");
    expect(req.authContext.isOwner).toBe(false);
    expect(req.authContext.membershipType).toBe("employee");
    expect(req.authContext.permissions).toContain("billing:create");
  });

  // ─── CASE 4: Employee cannot access a store without membership ─────────────
  test("Case 4: Employee cannot access a store where they have no membership", async () => {
    const storeB = {
      _id: storeBId,
      name: "Priya Boutique",
      owner: userPriyaId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeB);

    // Amit is NOT an employee of Store B
    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    req = {
      params: { storeId: storeBId },
      user: { _id: userAmitId },
    };

    const middleware = requirePermission("billing:create");
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ─── CASE 5: Suspended employee cannot access their assigned store ─────────
  test("Case 5: Suspended employee cannot access their assigned store", async () => {
    const storeA = {
      _id: storeAId,
      name: "Rahul Store",
      owner: userRahulId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeA);

    // Query for active employee returns null because Amit is suspended
    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    req = {
      params: { storeId: storeAId },
      user: { _id: userAmitId },
    };

    const middleware = requirePermission("billing:create");
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Access Denied: You do not have permission to access this store.",
      })
    );
  });

  // ─── CASE 6: Cashier cannot perform inventory management without permission ─
  test("Case 6: Employee with Cashier role cannot perform inventory management without permission", async () => {
    const storeA = {
      _id: storeAId,
      name: "Rahul Store",
      owner: userRahulId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeA);

    const cashierEmployee = {
      _id: "emp-amit-1",
      store: storeAId,
      user: userAmitId,
      status: "active",
      role: {
        _id: roleCashierStoreAId,
        name: "Cashier",
        store: storeAId,
        permissions: ["billing:create"], // Missing inventory:manage
      },
    };

    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(cashierEmployee),
    });

    req = {
      params: { storeId: storeAId },
      user: { _id: userAmitId },
    };

    const middleware = requirePermission("inventory:manage");
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("inventory:manage"),
        statusCode: 403,
      })
    );
  });

  // ─── CASE 7: Employee cannot use a role from another store ─────────────────
  test("Case 7: Employee cannot use a role belonging to another store", async () => {
    const storeA = {
      _id: storeAId,
      name: "Rahul Store",
      owner: userRahulId,
      isActive: true,
    };
    mockStoreFindById.mockResolvedValue(storeA);

    // Employee in storeA mistakenly configured with a role belonging to storeB
    const compromisedEmployee = {
      _id: "emp-amit-cross",
      store: storeAId,
      user: userAmitId,
      status: "active",
      role: {
        _id: roleStoreBId,
        name: "Store B Manager",
        store: storeBId, // Cross-tenant store!
        permissions: ["inventory:manage"],
      },
    };

    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(compromisedEmployee),
    });

    req = {
      params: { storeId: storeAId },
      user: { _id: userAmitId },
    };

    const middleware = requirePermission("inventory:manage");
    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Access Denied: Role belongs to another store.",
      })
    );
  });

  // ─── CASE 8: One user can be owner in one store and employee in another ────
  test("Case 8: One user (Priya) can be owner in Store B and employee in Store A", async () => {
    const storeA = {
      _id: storeAId,
      name: "Rahul Store",
      owner: userRahulId,
      isActive: true,
    };
    const storeB = {
      _id: storeBId,
      name: "Priya Boutique",
      owner: userPriyaId,
      isActive: true,
    };

    // 1. Priya accesses Store B (as Owner)
    mockStoreFindById.mockResolvedValue(storeB);
    const contextStoreB = await resolveStoreContextForUser(storeBId, userPriyaId);
    expect(contextStoreB.isOwner).toBe(true);
    expect(contextStoreB.membershipType).toBe("owner");
    expect(contextStoreB.roleName).toBe("Owner");
    expect(contextStoreB.permissions).toEqual(ALL_PERMISSIONS);

    // 2. Priya accesses Store A (as Manager Employee)
    mockStoreFindById.mockResolvedValue(storeA);
    const priyaEmployeeRecordStoreA = {
      _id: "emp-priya-storeA",
      store: storeAId,
      user: userPriyaId,
      status: "active",
      role: {
        _id: roleManagerStoreAId,
        name: "Manager",
        store: storeAId,
        permissions: ["billing:create", "inventory:add", "inventory:manage"],
      },
    };
    mockEmployeeFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(priyaEmployeeRecordStoreA),
    });

    const contextStoreA = await resolveStoreContextForUser(storeAId, userPriyaId);
    expect(contextStoreA.isOwner).toBe(false);
    expect(contextStoreA.membershipType).toBe("employee");
    expect(contextStoreA.roleName).toBe("Manager");
    expect(contextStoreA.permissions).toContain("inventory:manage");
  });

  // ─── CASE 9: User with no workspaces receives an empty workspace list ──────
  test("Case 9: User with no workspaces receives an empty workspace list without auto-creating store", async () => {
    mockStoreFind.mockReturnValue({
      sort: jest.fn().mockResolvedValue([]),
    });
    mockEmployeeFind.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue([]),
      }),
    });

    const workspaces = await getUserWorkspaces(userNewId);

    expect(workspaces).toEqual([]);
    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces).toHaveLength(0);
  });

  // ─── CASE 10: Manipulating store IDs cannot bypass authorization ───────────
  test("Case 10: Manipulating store IDs or supplying malformed IDs cannot bypass authorization", async () => {
    // 1. Missing storeId
    req = {
      params: {},
      user: { _id: userAmitId },
    };
    await requirePermission("billing:create")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // 2. Malformed ObjectId
    req = {
      params: { storeId: "malformed-non-object-id-123" },
      user: { _id: userAmitId },
    };
    await requirePermission("billing:create")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // 3. Store does not exist (404)
    const nonExistentStoreId = new mongoose.Types.ObjectId().toString();
    mockStoreFindById.mockResolvedValue(null);
    req = {
      params: { storeId: nonExistentStoreId },
      user: { _id: userAmitId },
    };
    await requirePermission("billing:create")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // ─── CASE 11: Store resources cannot be accessed across tenants by changing resource IDs ─
  test("Case 11: Store resources cannot be accessed across tenants by changing resource IDs", async () => {
    const prodAId = new mongoose.Types.ObjectId().toString();
    const prodBId = new mongoose.Types.ObjectId().toString();

    // Product lookup with storeId scope ensures tenant isolation
    mockProductFindOne.mockImplementation((query) => {
      if (query._id === prodBId && query.store === storeAId) {
        return Promise.resolve(null); // Not found in Store A!
      }
      return Promise.resolve(null);
    });

    // Amit from Store A tries to access Product B with store A scope
    await expect(getProductById(prodBId, storeAId)).rejects.toThrow("Product not found");

    // In Cart: Attempting to add Product B to a Cart belonging to Store A fails
    mockCartFindById.mockResolvedValue({
      _id: "cart-1",
      store: storeAId,
      status: "open",
      products: [],
    });

    mockProductFindOne.mockImplementation((query) => {
      // Product B belongs to Store B, so searching with store: storeAId returns null
      if (query._id === prodBId && query.store === storeAId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    await expect(addItemToCart("cart-1", prodBId, 1)).rejects.toThrow(
      "Product not found in this store"
    );
  });

  // ─── CASE 12: Existing owner functionality continues to work ───────────────
  test("Case 12: Existing owner functionality continues to work and store creation policy protects onboarding", async () => {
    // 1. Existing owner can create additional stores
    mockStoreCountDocuments.mockResolvedValue(1); // User owns 1 store already
    req = {
      user: { _id: userRahulId },
    };
    await requireStoreCreationEligibility(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // 2. New legitimate signup with 0 stores and 0 employee records can onboard and create initial store
    next.mockClear();
    mockStoreCountDocuments.mockResolvedValue(0);
    mockEmployeeCountDocuments.mockResolvedValue(0);
    req = {
      user: { _id: userNewId },
    };
    await requireStoreCreationEligibility(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // 3. Employee-only account cannot create store
    next.mockClear();
    mockStoreCountDocuments.mockResolvedValue(0); // 0 owned stores
    mockEmployeeCountDocuments.mockResolvedValue(1); // 1 employee membership
    req = {
      user: { _id: userAmitId },
    };
    await requireStoreCreationEligibility(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Forbidden: Employee-only accounts are not authorized to create stores.",
        statusCode: 403,
      })
    );

    // 4. requireOwner middleware allows legitimate owner
    next.mockClear();
    mockStoreFindById.mockResolvedValue({
      _id: storeAId,
      owner: userRahulId,
      isActive: true,
    });
    req = {
      params: { storeId: storeAId },
      user: { _id: userRahulId },
    };
    await requireOwner(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userRole).toBe("owner");
    expect(req.authContext.isOwner).toBe(true);
  });
});
