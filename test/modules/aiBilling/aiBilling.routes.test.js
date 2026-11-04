import { jest } from "@jest/globals";
import mongoose from "mongoose";

const mockStore = {
  findById: jest.fn(),
};

const mockEmployee = {
  findOne: jest.fn(),
};

const mockAiBillingService = {
  getOrCreateWallet: jest.fn(),
  getUsageHistory: jest.fn(),
  getTransactions: jest.fn(),
  reserveCredits: jest.fn(),
  settleCredits: jest.fn(),
  releaseReservation: jest.fn(),
};

jest.unstable_mockModule("../../../models/index.js", () => ({
  Store: mockStore,
  Employee: mockEmployee,
  User: {},
}));

jest.unstable_mockModule("../../../models/aiPricingConfig.model.js", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue(null),
    }),
  },
}));

jest.unstable_mockModule("../../../modules/aiBilling/aiBilling.service.js", () => ({
  ...mockAiBillingService,
}));

// Import controller handlers
const {
  getWalletController,
  getUsageController,
  getTransactionsController,
  getPricingController,
  internalReserveController,
  internalSettleController,
  internalReleaseController,
} = await import("../../../modules/aiBilling/aiBilling.controller.js");

describe("AI Billing API Controllers & Route Security", () => {
  const ownerId = new mongoose.Types.ObjectId();
  const employeeId = new mongoose.Types.ObjectId();
  const strangerId = new mongoose.Types.ObjectId();
  const storeId = new mongoose.Types.ObjectId();

  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      user: { _id: ownerId },
      query: {},
      params: {},
      body: {},
      headers: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe("GET /api/ai-billing/wallet", () => {
    test("owner gets their own wallet directly", async () => {
      req.user = { _id: ownerId };
      mockAiBillingService.getOrCreateWallet.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        balance: 1000,
        reservedBalance: 50,
        availableBalance: 950,
        monthlyLimit: 5000,
        monthlyUsed: 200,
        status: "active",
      });

      await getWalletController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            balance: 1000,
            availableBalance: 950,
            isSharedStoreWallet: false,
          }),
        })
      );
    });

    test("active employee with storeId accesses shared store wallet", async () => {
      req.user = { _id: employeeId };
      req.query = { storeId: storeId.toString() };

      mockStore.findById.mockResolvedValue({
        _id: storeId,
        owner: ownerId,
      });

      mockEmployee.findOne.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        store: storeId,
        user: employeeId,
        status: "active",
      });

      mockAiBillingService.getOrCreateWallet.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        balance: 2000,
        reservedBalance: 0,
        availableBalance: 2000,
        monthlyLimit: 10000,
        monthlyUsed: 500,
        status: "active",
      });

      await getWalletController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            isSharedStoreWallet: true,
            availableBalance: 2000,
          }),
        })
      );
    });

    test("blocks user from accessing another store's wallet if not a member", async () => {
      req.user = { _id: strangerId };
      req.query = { storeId: storeId.toString() };

      mockStore.findById.mockResolvedValue({
        _id: storeId,
        owner: ownerId, // Owned by someone else
      });

      mockEmployee.findOne.mockResolvedValue(null); // Not an employee

      await getWalletController(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringMatching(/Access Denied/i),
        })
      );
    });
  });

  describe("GET /api/ai-billing/transactions", () => {
    test("allows store owner to view wallet transactions", async () => {
      req.user = { _id: ownerId };
      mockAiBillingService.getTransactions.mockResolvedValue({
        transactions: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });

      await getTransactionsController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    test("blocks employee from viewing owner's financial transaction ledger", async () => {
      req.user = { _id: employeeId };
      req.query = { storeId: storeId.toString() };

      mockStore.findById.mockResolvedValue({
        _id: storeId,
        owner: ownerId,
      });

      mockEmployee.findOne.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        status: "active",
      });

      await getTransactionsController(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: expect.stringMatching(/Only store owners can view wallet transactions/i),
        })
      );
    });
  });

  describe("GET /api/ai-billing/pricing", () => {
    test("returns pricing config, formula, and rate conventions", async () => {
      await getPricingController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            formula: expect.stringContaining("ceil"),
            rateConventions: expect.any(Object),
          }),
        })
      );
    });
  });

  describe("Internal Service Operations", () => {
    test("internal reserve successfully executes service method", async () => {
      req.body = {
        ownerId: ownerId.toString(),
        executionId: "exec_internal_1",
        credits: 50,
      };

      mockAiBillingService.reserveCredits.mockResolvedValue({
        reservation: { executionId: "exec_internal_1", status: "active" },
        wallet: { balance: 950 },
      });

      await internalReserveController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAiBillingService.reserveCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: "exec_internal_1",
          credits: 50,
        })
      );
    });

    test("internal settle successfully executes service method", async () => {
      req.body = {
        executionId: "exec_internal_1",
        actualCredits: 35,
      };

      mockAiBillingService.settleCredits.mockResolvedValue({
        reservation: { executionId: "exec_internal_1", status: "settled" },
      });

      await internalSettleController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAiBillingService.settleCredits).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: "exec_internal_1",
          actualCredits: 35,
        })
      );
    });

    test("internal release successfully executes service method", async () => {
      req.body = {
        executionId: "exec_internal_1",
        reason: "Client disconnected",
      };

      mockAiBillingService.releaseReservation.mockResolvedValue({
        reservation: { executionId: "exec_internal_1", status: "released" },
      });

      await internalReleaseController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockAiBillingService.releaseReservation).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: "exec_internal_1",
          reason: "Client disconnected",
        })
      );
    });
  });
});
