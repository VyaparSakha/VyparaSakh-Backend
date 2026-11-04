import { ApiResponse } from "../../utils/ApiResponse.js";
import { Store, Employee } from "../../models/index.js";
import * as aiBillingService from "./aiBilling.service.js";
import { resolvePricingConfig, calculateCredits, DEFAULT_PRICING_CONFIG } from "./aiPricing.js";

/**
 * Resolves the billable owner and authorization context.
 *
 * Rules:
 * 1. Store Owner: Has full access to their wallet, transactions, and store usage records.
 * 2. Employee: If valid store membership exists, can read their store's shared wallet quota.
 *    Employees are never permitted to view another owner's wallet or private transaction history.
 */
const resolveOwnerContext = async (req) => {
  const userId = req.user?._id;
  if (!userId) {
    throw { statusCode: 401, message: "User authentication context missing" };
  }

  const storeId = req.query?.storeId || req.params?.storeId || req.body?.storeId || null;

  if (storeId) {
    const store = await Store.findById(storeId);
    if (!store) {
      throw { statusCode: 404, message: "Store not found" };
    }

    const storeOwnerId = store.owner?._id ? store.owner._id.toString() : store.owner?.toString();
    const currentUserId = userId.toString();

    if (storeOwnerId === currentUserId) {
      return {
        ownerId: storeOwnerId,
        isOwner: true,
        storeId: store._id,
      };
    }

    // Check active employee membership
    const employee = await Employee.findOne({
      store: store._id,
      user: userId,
      status: "active",
    });

    if (!employee) {
      throw {
        statusCode: 403,
        message: "Access Denied: You do not have active membership in this store workspace",
      };
    }

    return {
      ownerId: storeOwnerId,
      isOwner: false,
      isEmployee: true,
      storeId: store._id,
    };
  }

  // Without storeId, default to the user's own owner wallet
  return {
    ownerId: userId.toString(),
    isOwner: true,
    storeId: null,
  };
};

/**
 * GET /api/ai-billing/wallet
 * Returns current credit wallet details (balance, reserved, available, monthly limits)
 */
export const getWalletController = async (req, res) => {
  try {
    const context = await resolveOwnerContext(req);
    const wallet = await aiBillingService.getOrCreateWallet(context.ownerId);

    const responseData = {
      walletId: wallet._id,
      balance: wallet.balance,
      reservedBalance: wallet.reservedBalance,
      availableBalance: wallet.availableBalance,
      monthlyLimit: wallet.monthlyLimit,
      monthlyUsed: wallet.monthlyUsed,
      periodStart: wallet.periodStart,
      periodEnd: wallet.periodEnd,
      status: wallet.status,
      isSharedStoreWallet: !context.isOwner,
    };

    res
      .status(200)
      .json(new ApiResponse(responseData, "AI credit wallet retrieved successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message || "Failed to retrieve AI wallet", error.statusCode || 500));
  }
};

/**
 * GET /api/ai-billing/usage
 * Returns paginated usage records
 */
export const getUsageController = async (req, res) => {
  try {
    const context = await resolveOwnerContext(req);
    const { page, limit } = req.query;

    // Employees can only inspect usage for their assigned store
    const storeFilter = context.isOwner ? context.storeId : context.storeId;

    const history = await aiBillingService.getUsageHistory({
      ownerId: context.ownerId,
      storeId: storeFilter,
      page,
      limit,
    });

    res
      .status(200)
      .json(new ApiResponse(history, "AI credit usage history retrieved successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message || "Failed to retrieve AI usage history", error.statusCode || 500));
  }
};

/**
 * GET /api/ai-billing/transactions
 * Returns immutable credit transaction ledger (Owner only)
 */
export const getTransactionsController = async (req, res) => {
  try {
    const context = await resolveOwnerContext(req);

    if (!context.isOwner) {
      return res
        .status(403)
        .json(new ApiResponse(null, "Access Denied: Only store owners can view wallet transactions", 403));
    }

    const { page, limit, type } = req.query;
    const result = await aiBillingService.getTransactions({
      ownerId: context.ownerId,
      page,
      limit,
      type,
    });

    res
      .status(200)
      .json(new ApiResponse(result, "Credit transactions retrieved successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(
        new ApiResponse(
          null,
          error.message || "Failed to retrieve transactions",
          error.statusCode || 500
        )
      );
  }
};

/**
 * GET /api/ai-billing/pricing
 * Returns active pricing configuration and formula documentation
 */
export const getPricingController = async (req, res) => {
  try {
    const { featureName, provider, model } = req.query;
    const config = await resolvePricingConfig({ featureName, provider, model });

    const pricingInfo = {
      config,
      formula: "credits = ceil((inputTokens * inputRate + outputTokens * outputRate) / 1000)",
      rateConventions: {
        inputTokenCreditRate: "Credits billed per 1,000 input tokens",
        outputTokenCreditRate: "Credits billed per 1,000 output tokens",
        audioInputRate: "Credits billed per input unit (second)",
        audioOutputRate: "Credits billed per output unit (second)",
        minCharge: "Minimum credit charge applied to any executed call",
        maxExecutionCharge: "Maximum upper ceiling per execution to protect customer wallets",
      },
      sampleCalculation: calculateCredits({
        inputTokens: 500,
        outputTokens: 250,
        config,
      }),
    };

    res
      .status(200)
      .json(new ApiResponse(pricingInfo, "Pricing configuration retrieved successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json(new ApiResponse(null, error.message || "Failed to retrieve pricing", error.statusCode || 500));
  }
};

/**
 * Internal/Protected Operations:
 * These handlers are guarded by internal service credentials or trusted callers
 */

/**
 * POST /api/ai-billing/internal/check-balance
 * Fast pre-flight check without reserving or modifying balances.
 */
export const internalCheckBalanceController = async (req, res) => {
  try {
    const { ownerId, storeId, userId } = req.body;
    console.log("[AI BILLING] Internal check-balance request:", { ownerId, storeId, userId });
    const result = await aiBillingService.checkBalance({ ownerId, storeId, userId });
    res.status(200).json(new ApiResponse(result, "Balance checked successfully", 200));
  } catch (error) {
    console.error("[AI BILLING] Internal check-balance error:", error.message);
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Balance check failed", error.statusCode || 400));
  }
};

/**
 * POST /api/ai-billing/internal/reserve
 */
export const internalReserveController = async (req, res) => {
  try {
    const { ownerId, storeId, executionId, credits, featureName, metadata } = req.body;
    const result = await aiBillingService.reserveCredits({
      ownerId,
      storeId,
      executionId,
      credits,
      featureName,
      metadata,
    });

    res.status(200).json(new ApiResponse(result, "Credits reserved successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Reservation failed", error.statusCode || 400));
  }
};

/**
 * POST /api/ai-billing/internal/settle
 */
export const internalSettleController = async (req, res) => {
  try {
    const { executionId, actualCredits, idempotencyKey, metadata } = req.body;
    const result = await aiBillingService.settleCredits({
      executionId,
      actualCredits,
      idempotencyKey,
      metadata,
    });

    res.status(200).json(new ApiResponse(result, "Credits settled successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Settlement failed", error.statusCode || 400));
  }
};

/**
 * POST /api/ai-billing/internal/release
 */
export const internalReleaseController = async (req, res) => {
  try {
    const { executionId, reason } = req.body;
    const result = await aiBillingService.releaseReservation({ executionId, reason });

    res.status(200).json(new ApiResponse(result, "Reservation released successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Release failed", error.statusCode || 400));
  }
};

/**
 * POST /api/ai-billing/internal/report-usage
 * Receives normalized usage report from Python FastAPI service, calculates authoritative
 * charges using configured rates, settles reservation, and persists audited usage record.
 */
export const internalReportUsageController = async (req, res) => {
  try {
    const {
      executionId,
      userId,
      storeId,
      feature,
      provider,
      model,
      inputTokens,
      outputTokens,
      audioInputUnits,
      audioOutputUnits,
      voiceDurationSeconds,
      modelBreakdown,
      executionStatus,
      metadata,
    } = req.body;

    const result = await aiBillingService.recordUsageAndSettle({
      executionId,
      userId,
      storeId,
      feature,
      provider,
      model,
      inputTokens,
      outputTokens,
      audioInputUnits,
      audioOutputUnits,
      voiceDurationSeconds,
      modelBreakdown,
      executionStatus,
      metadata,
    });

    res
      .status(200)
      .json(new ApiResponse(result, "Usage reported and settled successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(
        new ApiResponse(
          null,
          error.message || "Failed to record usage and settle",
          error.statusCode || 400
        )
      );
  }
};

/**
 * PUT /api/ai-billing/settings
 * Update wallet settings (monthly limits, administrative controls) — Owner only
 */
export const updateSettingsController = async (req, res) => {
  try {
    const context = await resolveOwnerContext(req);
    if (!context.isOwner) {
      return res
        .status(403)
        .json(new ApiResponse(null, "Only business owners can update AI billing settings", 403));
    }

    const { monthlyLimit } = req.body;
    const wallet = await aiBillingService.updateWalletSettings({
      ownerId: context.ownerId,
      monthlyLimit,
    });

    res
      .status(200)
      .json(new ApiResponse(wallet, "AI billing settings updated successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Failed to update settings", error.statusCode || 400));
  }
};

/**
 * GET /api/ai-billing/packages
 * Returns available top-up credit booster packages
 */
export const getPackagesController = async (req, res) => {
  try {
    const packages = Object.values(aiBillingService.TOP_UP_PACKAGES);
    res
      .status(200)
      .json(new ApiResponse(packages, "Available top-up packages retrieved successfully", 200));
  } catch (error) {
    res
      .status(500)
      .json(new ApiResponse(null, "Failed to load packages", 500));
  }
};

/**
 * POST /api/ai-billing/top-up/create-order
 * Creates an order reference for Razorpay top-up
 */
export const createTopUpOrderController = async (req, res) => {
  try {
    const context = await resolveOwnerContext(req);
    if (!context.isOwner) {
      return res
        .status(403)
        .json(new ApiResponse(null, "Only business owners can purchase AI credit top-ups", 403));
    }

    const { packageId } = req.body;
    const order = await aiBillingService.createTopUpOrder({
      ownerId: context.ownerId,
      packageId,
    });

    res
      .status(200)
      .json(new ApiResponse(order, "Top-up order created successfully", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Failed to create order", error.statusCode || 400));
  }
};

/**
 * POST /api/ai-billing/top-up/verify
 * Verifies Razorpay signature and applies credits atomically with idempotency
 */
export const verifyTopUpController = async (req, res) => {
  try {
    const context = await resolveOwnerContext(req);
    if (!context.isOwner) {
      return res
        .status(403)
        .json(new ApiResponse(null, "Only business owners can complete top-ups", 403));
    }

    const { orderId, paymentId, signature, packageId } = req.body;
    const result = await aiBillingService.verifyAndApplyTopUp({
      ownerId: context.ownerId,
      orderId,
      paymentId,
      signature,
      packageId,
    });

    res
      .status(200)
      .json(new ApiResponse(result, "Credits successfully added to wallet", 200));
  } catch (error) {
    res
      .status(error.statusCode || 400)
      .json(new ApiResponse(null, error.message || "Payment verification failed", error.statusCode || 400));
  }
};


