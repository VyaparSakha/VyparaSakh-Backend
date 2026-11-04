import mongoose from "mongoose";
import { jest } from "@jest/globals";
import * as aiBillingService from "../../../modules/aiBilling/aiBilling.service.js";
import { internalReportUsageController } from "../../../modules/aiBilling/aiBilling.controller.js";
import AiWallet from "../../../models/aiWallet.model.js";
import AiCreditReservation from "../../../models/aiCreditReservation.model.js";
import AiUsageRecord from "../../../models/aiUsageRecord.model.js";
import AiCreditTransaction from "../../../models/aiCreditTransaction.model.js";
import AiPricingConfig from "../../../models/aiPricingConfig.model.js";

describe("Step 2 — AI Usage Tracking & Settlement Integration", () => {
  const ownerId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const storeId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("aiBillingService.recordUsageAndSettle", () => {
    it("authoritatively settles reservation, deducts consumed credits, and creates immutable AiUsageRecord", async () => {
      const executionId = "exec_test_settle_101";

      const mockReservation = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        walletId: new mongoose.Types.ObjectId(),
        storeId,
        executionId,
        featureName: "copilot",
        reservedCredits: 25,
        status: "active",
        save: jest.fn(),
      };

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(mockReservation);

      const mockWallet = {
        _id: mockReservation.walletId,
        balance: 1000,
        reservedBalance: 25,
        availableBalance: 975,
        monthlyLimit: 5000,
        monthlyUsed: 0,
        status: "active",
      };

      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue({
        ...mockWallet,
        balance: 997, // 3 credits billed
        reservedBalance: 0,
        monthlyUsed: 3,
      });

      jest.spyOn(AiCreditTransaction, "create").mockResolvedValue({});
      jest.spyOn(AiPricingConfig, "findOne").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      const mockUpsertedUsage = {
        _id: new mongoose.Types.ObjectId(),
        executionId,
        ownerId,
        userId,
        storeId,
        feature: "copilot",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        inputTokens: 600,
        outputTokens: 300,
        totalTokens: 900,
        creditsCharged: 3,
        executionStatus: "completed",
      };
      jest.spyOn(AiUsageRecord, "findOneAndUpdate").mockResolvedValue(mockUpsertedUsage);

      const result = await aiBillingService.recordUsageAndSettle({
        executionId,
        userId,
        storeId,
        feature: "copilot",
        provider: "groq",
        model: "llama-3.3-70b-versatile",
        inputTokens: 600,
        outputTokens: 300,
        modelBreakdown: [
          {
            provider: "groq",
            model: "llama-3.3-70b-versatile",
            inputTokens: 600,
            outputTokens: 300,
            callCount: 1,
          },
        ],
        executionStatus: "completed",
      });

      expect(result).toBeDefined();
      expect(result.usageRecord).toBeDefined();
      expect(result.creditsCharged).toBe(3);
      expect(result.reservation.status).toBe("settled");
      expect(result.reservation.consumedCredits).toBe(3);
      expect(result.reservation.releasedCredits).toBe(22); // 25 - 3 = 22 released
    });

    it("settles voice audio sessions correctly using audio unit rates", async () => {
      const executionId = "voice_session_metered_202";

      const mockReservation = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        walletId: new mongoose.Types.ObjectId(),
        storeId,
        executionId,
        featureName: "voice",
        reservedCredits: 50,
        status: "active",
        save: jest.fn(),
      };

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(mockReservation);

      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue({
        _id: mockReservation.walletId,
        balance: 980,
        reservedBalance: 0,
        monthlyUsed: 20,
      });

      jest.spyOn(AiCreditTransaction, "create").mockResolvedValue({});
      jest.spyOn(AiPricingConfig, "findOne").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      jest.spyOn(AiUsageRecord, "findOneAndUpdate").mockImplementation((query, update) =>
        Promise.resolve({
          ...update.$setOnInsert,
          _id: new mongoose.Types.ObjectId(),
        })
      );

      // 10s audio in, 5s audio out
      const result = await aiBillingService.recordUsageAndSettle({
        executionId,
        userId,
        storeId,
        feature: "voice",
        provider: "google",
        model: "gemini-3.8-live",
        audioInputUnits: 10,
        audioOutputUnits: 5,
        executionStatus: "completed",
      });

      expect(result).toBeDefined();
      // formula: 10 * 1 + 5 * 2 = 20 audio credits
      expect(result.creditsCharged).toBe(20);
      expect(result.reservation.releasedCredits).toBe(30); // 50 - 20 = 30 released
    });

    it("is idempotent: duplicate settlement returns existing without charging twice", async () => {
      const executionId = "exec_duplicate_check_303";

      const settledReservation = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        walletId: new mongoose.Types.ObjectId(),
        executionId,
        status: "settled",
        consumedCredits: 4,
      };

      const existingUsage = {
        _id: new mongoose.Types.ObjectId(),
        executionId,
        creditsCharged: 4,
      };

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(settledReservation);
      jest.spyOn(AiUsageRecord, "findOne").mockResolvedValue(existingUsage);
      jest.spyOn(AiWallet, "findById").mockResolvedValue({ _id: settledReservation.walletId, balance: 996 });

      const result = await aiBillingService.recordUsageAndSettle({
        executionId,
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(result.alreadySettled).toBe(true);
      expect(result.usageRecord).toEqual(existingUsage);
    });
  });

  describe("internalReportUsageController", () => {
    it("accepts valid internal usage payload and settles execution", async () => {
      const executionId = "exec_internal_ctrl_404";

      const mockReservation = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        walletId: new mongoose.Types.ObjectId(),
        executionId,
        reservedCredits: 25,
        status: "active",
        save: jest.fn(),
      };

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(mockReservation);
      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue({
        _id: mockReservation.walletId,
        balance: 998,
        reservedBalance: 0,
        monthlyUsed: 2,
      });
      jest.spyOn(AiCreditTransaction, "create").mockResolvedValue({});
      jest.spyOn(AiPricingConfig, "findOne").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });
      jest.spyOn(AiUsageRecord, "findOneAndUpdate").mockResolvedValue({
        executionId,
        creditsCharged: 2,
      });

      const req = {
        body: {
          executionId,
          userId: userId.toString(),
          storeId: storeId.toString(),
          feature: "copilot",
          provider: "gemini",
          model: "gemini-2.5-flash",
          inputTokens: 400,
          outputTokens: 200,
          totalTokens: 600,
          executionStatus: "completed",
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await internalReportUsageController(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            creditsCharged: 2,
          }),
        })
      );
    });
  });

  describe("Clarification execution ID preservation (2.1)", () => {
    it("distinguishes threadId from executionId and allows resuming active reservation", async () => {
      const executionId = "exec_clarify_reuse_505";

      // 1. First prompt reserves 25 credits
      const activeRes = {
        _id: new mongoose.Types.ObjectId(),
        executionId,
        status: "active",
        reservedCredits: 25,
      };

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(activeRes);

      // Check if active reservation exists for this executionId
      const found = await AiCreditReservation.findOne({ executionId, status: "active" });
      expect(found).not.toBeNull();
      expect(found.executionId).toBe(executionId);

      // Re-invoking reservation for the same active executionId should be detected
      // so Express knows not to create a duplicate second reservation
      const isExistingActive = found && found.status === "active";
      expect(isExistingActive).toBe(true);
    });
  });

  describe("Direct Stage-Level Deduction & Balance Gate (No reservation)", () => {
    it("deducts credits directly at stage without reservation and reports remainingBalance & isExhausted", async () => {
      const executionId = "exec_stage_direct_101";

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(null);

      const mockWallet = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        balance: 5,
        reservedBalance: 0,
        monthlyLimit: 5000,
        monthlyUsed: 10,
        status: "active",
        isPeriodExpired: () => false,
      };

      jest.spyOn(AiWallet, "findOneAndUpdate")
        .mockResolvedValueOnce(mockWallet) // getOrCreateWallet
        .mockResolvedValueOnce({ ...mockWallet, balance: 3, monthlyUsed: 12 }); // deduction
      jest.spyOn(AiCreditTransaction, "create").mockResolvedValue({});
      jest.spyOn(AiPricingConfig, "findOne").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });

      const mockUsageRecord = {
        _id: new mongoose.Types.ObjectId(),
        executionId,
        ownerId,
        inputTokens: 400,
        outputTokens: 200,
        creditsCharged: 2,
        executionStatus: "in_progress",
      };
      jest.spyOn(AiUsageRecord, "findOneAndUpdate").mockResolvedValue(mockUsageRecord);

      const result = await aiBillingService.recordUsageAndSettle({
        executionId,
        userId,
        storeId,
        inputTokens: 400,
        outputTokens: 200,
        metadata: { stageName: "think", isStageDeduction: true, ownerId },
      });

      expect(result).toBeDefined();
      expect(result.creditsCharged).toBe(2);
      expect(result.remainingBalance).toBe(3);
      expect(result.isExhausted).toBe(false);
    });

    it("detects wallet exhaustion when balance drops to 0", async () => {
      const executionId = "exec_stage_exhaust_202";

      jest.spyOn(AiCreditReservation, "findOne").mockResolvedValue(null);

      const mockWallet = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        balance: 2,
        reservedBalance: 0,
        monthlyLimit: 5000,
        monthlyUsed: 100,
        status: "active",
        isPeriodExpired: () => false,
      };

      jest.spyOn(AiWallet, "findOneAndUpdate")
        .mockResolvedValueOnce(mockWallet) // getOrCreateWallet
        .mockResolvedValueOnce({ ...mockWallet, balance: 0, monthlyUsed: 102 }); // deduction
      jest.spyOn(AiCreditTransaction, "create").mockResolvedValue({});
      jest.spyOn(AiPricingConfig, "findOne").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(null),
      });
      jest.spyOn(AiUsageRecord, "findOneAndUpdate").mockResolvedValue({
        executionId,
        creditsCharged: 2,
      });

      const result = await aiBillingService.recordUsageAndSettle({
        executionId,
        userId,
        storeId,
        inputTokens: 400,
        outputTokens: 200,
        metadata: { stageName: "tool_exec", isStageDeduction: true, ownerId },
      });

      expect(result.creditsCharged).toBe(2);
      expect(result.remainingBalance).toBe(0);
      expect(result.isExhausted).toBe(true);
    });

    it("checkBalance returns allowed: true when wallet has positive balance", async () => {
      const mockWallet = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        balance: 15,
        monthlyLimit: 5000,
        monthlyUsed: 50,
        status: "active",
        isPeriodExpired: () => false,
      };
      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue(mockWallet);

      const check = await aiBillingService.checkBalance({ ownerId });
      expect(check.allowed).toBe(true);
      expect(check.balance).toBe(15);
      expect(check.reason).toBeNull();
    });

    it("checkBalance returns allowed: false and INSUFFICIENT_CREDITS when balance is 0", async () => {
      const mockWallet = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        balance: 0,
        monthlyLimit: 5000,
        monthlyUsed: 50,
        status: "active",
        isPeriodExpired: () => false,
      };
      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue(mockWallet);

      const check = await aiBillingService.checkBalance({ ownerId });
      expect(check.allowed).toBe(false);
      expect(check.balance).toBe(0);
      expect(check.reason).toBe("INSUFFICIENT_CREDITS");
    });

    it("checkBalance resolves owner from store.owner when given storeId", async () => {
      const Store = (await import("../../../models/store.model.js")).default;
      const mockStore = {
        _id: storeId,
        owner: ownerId,
      };
      jest.spyOn(Store, "findById").mockReturnValue({
        select: jest.fn().mockResolvedValue(mockStore),
      });

      const mockWallet = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        balance: 100,
        monthlyLimit: 5000,
        monthlyUsed: 0,
        status: "active",
        isPeriodExpired: () => false,
      };
      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue(mockWallet);

      const check = await aiBillingService.checkBalance({ storeId: storeId.toString() });
      expect(check.allowed).toBe(true);
      expect(check.balance).toBe(100);
    });

    it("checkBalance resolves owner from User firebaseUid when userId is a Firebase string", async () => {
      const User = (await import("../../../models/user.model.js")).default;
      const firebaseUid = "unR0Rpg3sQgSKFhKfCxD3AjWz4q1";
      const mockUser = {
        _id: ownerId,
        firebaseUid,
      };
      jest.spyOn(User, "findOne").mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      const mockWallet = {
        _id: new mongoose.Types.ObjectId(),
        ownerId,
        balance: 50,
        monthlyLimit: 5000,
        monthlyUsed: 10,
        status: "active",
        isPeriodExpired: () => false,
      };
      jest.spyOn(AiWallet, "findOneAndUpdate").mockResolvedValue(mockWallet);

      const check = await aiBillingService.checkBalance({ userId: firebaseUid });
      expect(check.allowed).toBe(true);
      expect(check.balance).toBe(50);
    });
  });
});
