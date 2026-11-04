import { jest } from "@jest/globals";
import mongoose from "mongoose";

// Setup mocks for Mongoose models before importing the service
const mockAiWallet = {
  findOneAndUpdate: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

const mockAiCreditReservation = {
  create: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};

const mockAiCreditTransaction = {
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};

const mockAiPricingConfig = {
  findOne: jest.fn(),
};

jest.unstable_mockModule("../../../models/aiWallet.model.js", () => ({
  __esModule: true,
  default: mockAiWallet,
  getCalendarMonthPeriod: () => ({
    periodStart: new Date(2026, 10, 1, 0, 0, 0, 0),
    periodEnd: new Date(2026, 10, 30, 23, 59, 59, 999),
  }),
}));

jest.unstable_mockModule("../../../models/aiCreditReservation.model.js", () => ({
  __esModule: true,
  default: mockAiCreditReservation,
}));

jest.unstable_mockModule("../../../models/aiCreditTransaction.model.js", () => ({
  __esModule: true,
  default: mockAiCreditTransaction,
}));

jest.unstable_mockModule("../../../models/aiPricingConfig.model.js", () => ({
  __esModule: true,
  default: mockAiPricingConfig,
}));

// Dynamic import of modules under test
const {
  getOrCreateWallet,
  reserveCredits,
  settleCredits,
  releaseReservation,
  getUsageHistory,
  getTransactions,
  grantCredits,
  DEFAULT_INITIAL_BALANCE,
  DEFAULT_MONTHLY_LIMIT,
} = await import("../../../modules/aiBilling/aiBilling.service.js");

const { calculateCredits, DEFAULT_PRICING_CONFIG } = await import(
  "../../../modules/aiBilling/aiPricing.js"
);

describe("AI Credit & Usage Limit Billing Foundation", () => {
  const ownerId = new mongoose.Types.ObjectId().toString();
  const storeId = new mongoose.Types.ObjectId().toString();
  const walletId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("1. Pricing & Formula Calculations", () => {
    test("calculates token credits using ceil((input * rate + output * rate) / 1000)", () => {
      // 1000 input @ 2/1k = 2 credits
      // 1000 output @ 6/1k = 6 credits
      // Total = 8 credits
      const res = calculateCredits({
        inputTokens: 1000,
        outputTokens: 1000,
        config: { inputTokenCreditRate: 2, outputTokenCreditRate: 6 },
      });
      expect(res.credits).toBe(8);
      expect(res.tokenCredits).toBe(8);
    });

    test("enforces minimum charge (minCharge = 1) even for tiny token usage", () => {
      const res = calculateCredits({
        inputTokens: 5,
        outputTokens: 5,
        config: { inputTokenCreditRate: 2, outputTokenCreditRate: 6, minCharge: 1 },
      });
      expect(res.credits).toBe(1);
    });

    test("enforces upper ceiling cap (maxExecutionCharge)", () => {
      const res = calculateCredits({
        inputTokens: 1000000,
        outputTokens: 1000000,
        config: {
          inputTokenCreditRate: 2,
          outputTokenCreditRate: 6,
          maxExecutionCharge: 150,
        },
      });
      expect(res.credits).toBe(150);
    });

    test("meters audio inputs and outputs correctly", () => {
      const res = calculateCredits({
        inputTokens: 0,
        outputTokens: 0,
        audioInputUnits: 10, // 10 seconds @ 1 credit/s = 10
        audioOutputUnits: 5, // 5 seconds @ 2 credits/s = 10
        config: { audioInputRate: 1, audioOutputRate: 2, minCharge: 1, maxExecutionCharge: 250 },
      });
      expect(res.audioCredits).toBe(20);
      expect(res.credits).toBe(20);
    });
  });

  describe("2. Wallet Lifecycle & Concurrency (1.1)", () => {
    test("creates wallet atomically on first access with initial balance and log transaction", async () => {
      const mockCreatedWallet = {
        _id: walletId,
        ownerId,
        balance: DEFAULT_INITIAL_BALANCE,
        reservedBalance: 0,
        monthlyLimit: DEFAULT_MONTHLY_LIMIT,
        monthlyUsed: 0,
        status: "active",
        availableBalance: DEFAULT_INITIAL_BALANCE,
        isPeriodExpired: jest.fn().mockReturnValue(false),
      };

      mockAiWallet.findOneAndUpdate.mockResolvedValue(mockCreatedWallet);
      mockAiCreditTransaction.create.mockResolvedValue({});

      const wallet = await getOrCreateWallet(ownerId);

      expect(mockAiWallet.findOneAndUpdate).toHaveBeenCalledWith(
        { ownerId: expect.any(mongoose.Types.ObjectId) },
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            balance: DEFAULT_INITIAL_BALANCE,
            monthlyLimit: DEFAULT_MONTHLY_LIMIT,
            status: "active",
          }),
        }),
        expect.objectContaining({ upsert: true, new: true })
      );
      expect(wallet.balance).toBe(DEFAULT_INITIAL_BALANCE);
      expect(mockAiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "credit_grant",
          amount: DEFAULT_INITIAL_BALANCE,
        })
      );
    });

    test("auto-resets monthly usage when billing period has elapsed", async () => {
      const expiredWallet = {
        _id: walletId,
        ownerId,
        balance: 800,
        reservedBalance: 0,
        monthlyLimit: 5000,
        monthlyUsed: 4900,
        status: "active",
        availableBalance: 800,
        isPeriodExpired: jest.fn().mockReturnValue(true),
      };

      const rolledOverWallet = {
        ...expiredWallet,
        monthlyUsed: 0,
        isPeriodExpired: jest.fn().mockReturnValue(false),
      };

      // First call for getOrCreateWallet upsert returns expiredWallet
      mockAiWallet.findOneAndUpdate
        .mockResolvedValueOnce(expiredWallet)
        .mockResolvedValueOnce(rolledOverWallet);

      const wallet = await getOrCreateWallet(ownerId);
      expect(mockAiWallet.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(wallet.monthlyUsed).toBe(0);
    });
  });

  describe("3. Credit Reservation (1.3 & 1.5.B)", () => {
    test("successfully reserves credits atomically", async () => {
      const executionId = "exec_test_001";
      const creditsToReserve = 25;

      mockAiCreditReservation.findOne.mockResolvedValue(null); // No duplicate

      const currentWallet = {
        _id: walletId,
        ownerId,
        balance: 1000,
        reservedBalance: 0,
        monthlyLimit: 5000,
        monthlyUsed: 100,
        status: "active",
        availableBalance: 1000,
        isPeriodExpired: jest.fn().mockReturnValue(false),
      };
      mockAiWallet.findOneAndUpdate
        .mockResolvedValueOnce(currentWallet) // getOrCreateWallet
        .mockResolvedValueOnce({
          // atomic reservation
          ...currentWallet,
          reservedBalance: 25,
          availableBalance: 975,
        });

      mockAiCreditReservation.create.mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        executionId,
        reservedCredits: 25,
        status: "active",
      });

      mockAiCreditTransaction.create.mockResolvedValue({});

      const result = await reserveCredits({
        ownerId,
        storeId,
        executionId,
        credits: creditsToReserve,
        featureName: "copilot",
      });

      expect(result.reservation.status).toBe("active");
      expect(result.reservation.reservedCredits).toBe(25);
      expect(mockAiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "reservation",
          amount: 25,
          executionId,
        })
      );
    });

    test("fails reservation when available balance is insufficient", async () => {
      const executionId = "exec_insufficient_001";
      mockAiCreditReservation.findOne.mockResolvedValue(null);

      const poorWallet = {
        _id: walletId,
        ownerId,
        balance: 10,
        reservedBalance: 5,
        monthlyLimit: 5000,
        monthlyUsed: 0,
        status: "active",
        availableBalance: 5,
        isPeriodExpired: jest.fn().mockReturnValue(false),
      };

      mockAiWallet.findOneAndUpdate
        .mockResolvedValueOnce(poorWallet) // getOrCreateWallet
        .mockResolvedValueOnce(null); // Atomic condition failed ($gte balance-reserved)

      mockAiWallet.findById.mockResolvedValue(poorWallet);

      await expect(
        reserveCredits({
          ownerId,
          executionId,
          credits: 50,
        })
      ).rejects.toThrow(/Insufficient available AI credits/);
    });

    test("fails reservation when monthly limit would be exceeded", async () => {
      const executionId = "exec_limit_exceeded_001";
      mockAiCreditReservation.findOne.mockResolvedValue(null);

      const maxedWallet = {
        _id: walletId,
        ownerId,
        balance: 10000,
        reservedBalance: 100,
        monthlyLimit: 5000,
        monthlyUsed: 4950,
        status: "active",
        availableBalance: 9900,
        isPeriodExpired: jest.fn().mockReturnValue(false),
      };

      mockAiWallet.findOneAndUpdate
        .mockResolvedValueOnce(maxedWallet)
        .mockResolvedValueOnce(null); // Atomic condition failed: monthly limit would be exceeded

      mockAiWallet.findById.mockResolvedValue(maxedWallet);

      await expect(
        reserveCredits({
          ownerId,
          executionId,
          credits: 100,
        })
      ).rejects.toThrow(/Monthly AI usage limit exceeded/);
    });

    test("rejects duplicate reservation attempt for the same executionId", async () => {
      const executionId = "exec_duplicate_001";
      mockAiCreditReservation.findOne.mockResolvedValue({
        executionId,
        status: "active",
      });

      await expect(
        reserveCredits({
          ownerId,
          executionId,
          credits: 10,
        })
      ).rejects.toThrow(/Active reservation already exists/);
    });

    test("rejects invalid execution IDs and non-positive credit amounts", async () => {
      await expect(
        reserveCredits({
          ownerId,
          executionId: "",
          credits: 10,
        })
      ).rejects.toThrow(/valid executionId/);

      await expect(
        reserveCredits({
          ownerId,
          executionId: "exec_invalid_val",
          credits: -5,
        })
      ).rejects.toThrow(/positive integer greater than zero/);

      await expect(
        reserveCredits({
          ownerId,
          executionId: "exec_invalid_float",
          credits: 5.5,
        })
      ).rejects.toThrow(/positive integer greater than zero/);
    });
  });

  describe("4. Credit Settlement (1.5.C)", () => {
    test("successfully settles consumed credits and releases unused reserved balance", async () => {
      const executionId = "exec_settle_001";
      const reservation = {
        _id: new mongoose.Types.ObjectId(),
        walletId,
        ownerId,
        storeId,
        executionId,
        reservedCredits: 50,
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      mockAiCreditReservation.findOne.mockResolvedValue(reservation);

      const updatedWallet = {
        _id: walletId,
        balance: 970, // 1000 - 30 consumed
        reservedBalance: 0, // was 50, decremented by full 50
        monthlyUsed: 30,
      };
      mockAiWallet.findOneAndUpdate.mockResolvedValue(updatedWallet);
      mockAiCreditTransaction.create.mockResolvedValue({});

      const result = await settleCredits({
        executionId,
        actualCredits: 30, // consumed 30 out of 50 reserved; 20 should be released
      });

      expect(reservation.status).toBe("settled");
      expect(reservation.consumedCredits).toBe(30);
      expect(reservation.releasedCredits).toBe(20);
      expect(reservation.save).toHaveBeenCalled();

      // Check atomic update on wallet
      expect(mockAiWallet.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: walletId, reservedBalance: { $gte: 50 } },
        {
          $inc: {
            balance: -30,
            reservedBalance: -50,
            monthlyUsed: 30,
          },
        },
        { new: true }
      );

      // Verify immutable usage charge transaction
      expect(mockAiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "usage_charge",
          amount: 30,
          executionId,
        })
      );

      // Verify unused release transaction
      expect(mockAiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "reservation_release",
          amount: 20,
          executionId,
        })
      );
    });

    test("settlement is idempotent: duplicate settlement returns existing without double charging", async () => {
      const executionId = "exec_idempotent_001";
      const settledReservation = {
        executionId,
        status: "settled",
        consumedCredits: 20,
        walletId,
      };

      mockAiCreditReservation.findOne.mockResolvedValue(settledReservation);
      mockAiWallet.findById.mockResolvedValue({ _id: walletId, balance: 980 });

      const result = await settleCredits({
        executionId,
        actualCredits: 20,
      });

      expect(result.alreadySettled).toBe(true);
      expect(mockAiWallet.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test("caps actual usage at max execution charge to protect customers", async () => {
      const executionId = "exec_runaway_001";
      const reservation = {
        _id: new mongoose.Types.ObjectId(),
        walletId,
        ownerId,
        storeId,
        executionId,
        reservedCredits: 250,
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      mockAiCreditReservation.findOne.mockResolvedValue(reservation);
      mockAiWallet.findOneAndUpdate.mockResolvedValue({ _id: walletId, balance: 750 });
      mockAiCreditTransaction.create.mockResolvedValue({});

      await settleCredits({
        executionId,
        actualCredits: 999999, // Runaway usage reported
      });

      // Billed credits must be capped at 250 (maxExecutionCharge)
      expect(reservation.consumedCredits).toBe(250);
    });
  });

  describe("5. Releasing Reservations (1.5.D)", () => {
    test("successfully releases reservation in full when operation aborts or errors", async () => {
      const executionId = "exec_abort_001";
      const reservation = {
        _id: new mongoose.Types.ObjectId(),
        walletId,
        ownerId,
        storeId,
        executionId,
        reservedCredits: 40,
        status: "active",
        save: jest.fn().mockResolvedValue(true),
      };

      mockAiCreditReservation.findOne.mockResolvedValue(reservation);
      mockAiWallet.findOneAndUpdate.mockResolvedValue({
        _id: walletId,
        balance: 1000,
        reservedBalance: 0,
      });
      mockAiCreditTransaction.create.mockResolvedValue({});

      const result = await releaseReservation({
        executionId,
        reason: "User closed SSE connection",
      });

      expect(reservation.status).toBe("released");
      expect(reservation.releasedCredits).toBe(40);
      expect(reservation.consumedCredits).toBe(0);

      // Atomically decrement reserved balance without touching actual balance
      expect(mockAiWallet.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: walletId, reservedBalance: { $gte: 40 } },
        { $inc: { reservedBalance: -40 } },
        { new: true }
      );

      expect(mockAiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "reservation_release",
          amount: 40,
          executionId,
        })
      );
    });

    test("duplicate release is idempotent and does not release twice", async () => {
      const executionId = "exec_dup_release_001";
      const releasedReservation = {
        executionId,
        status: "released",
        releasedCredits: 40,
        walletId,
      };

      mockAiCreditReservation.findOne.mockResolvedValue(releasedReservation);
      mockAiWallet.findById.mockResolvedValue({ _id: walletId });

      const result = await releaseReservation({ executionId });
      expect(result.alreadyReleased).toBe(true);
      expect(mockAiWallet.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("6. Transaction & Usage History (1.5.E)", () => {
    test("retrieves paginated usage history filtered by owner and store", async () => {
      const records = [
        {
          _id: new mongoose.Types.ObjectId(),
          executionId: "exec_1",
          featureName: "copilot",
          status: "settled",
          reservedCredits: 20,
          consumedCredits: 15,
          releasedCredits: 5,
          createdAt: new Date(),
          storeId: { _id: storeId, name: "Kirana Main Branch" },
        },
      ];

      mockAiCreditReservation.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              populate: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(records),
              }),
            }),
          }),
        }),
      });
      mockAiCreditReservation.countDocuments.mockResolvedValue(1);

      const history = await getUsageHistory({ ownerId, storeId, page: 1, limit: 10 });
      expect(history.total).toBe(1);
      expect(history.records.length).toBe(1);
      expect(history.records[0].creditsConsumed).toBe(15);
      expect(history.records[0].store.name).toBe("Kirana Main Branch");
    });
  });

  describe("7. Credit Grants & Purchases", () => {
    test("grants additional credits and creates transaction record", async () => {
      mockAiWallet.findOneAndUpdate.mockResolvedValue({
        _id: walletId,
        ownerId,
        balance: 1000,
        status: "active",
        isPeriodExpired: () => false,
      });

      mockAiWallet.findByIdAndUpdate.mockResolvedValue({
        _id: walletId,
        balance: 1500,
      });
      mockAiCreditTransaction.create.mockResolvedValue({});

      const updated = await grantCredits({
        ownerId,
        amount: 500,
        type: "credit_purchase",
        description: "Razorpay 500 credit pack",
      });

      expect(updated.balance).toBe(1500);
      expect(mockAiCreditTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "credit_purchase",
          amount: 500,
          balanceAfter: 1500,
        })
      );
    });
  });
});

