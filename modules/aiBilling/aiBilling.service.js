import crypto from "crypto";
import mongoose from "mongoose";
import Store from "../../models/store.model.js";
import AiWallet, { getCalendarMonthPeriod } from "../../models/aiWallet.model.js";
import AiCreditTransaction from "../../models/aiCreditTransaction.model.js";
import AiCreditReservation from "../../models/aiCreditReservation.model.js";
import AiUsageRecord from "../../models/aiUsageRecord.model.js";
import { DEFAULT_PRICING_CONFIG, resolvePricingConfig, calculateCredits } from "./aiPricing.js";

export const DEFAULT_INITIAL_BALANCE = 1000; // Free welcome grant for store owners
export const DEFAULT_MONTHLY_LIMIT = 5000; // Monthly usage cap for safety
export const DEFAULT_RESERVATION_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

/**
 * Normalizes an ID to an ObjectId or null
 */
const toObjectId = (id) => {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id === "string" && mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  return id;
};

/**
 * 1.5.A Get or Create Wallet
 *
 * Atomically retrieves or creates a business owner's credit wallet.
 * Resets monthly usage if the billing period has elapsed (calendar-month based).
 *
 * @param {string|mongoose.Types.ObjectId} ownerId
 * @returns {Promise<AiWallet>}
 */
export const getOrCreateWallet = async (ownerId) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("Invalid or missing ownerId for AI wallet lookup");
  }

  const { periodStart, periodEnd } = getCalendarMonthPeriod();

  // Safe atomic upsert prevents duplicate wallet creation under concurrent requests
  let wallet = await AiWallet.findOneAndUpdate(
    { ownerId: normalizedOwnerId },
    {
      $setOnInsert: {
        ownerId: normalizedOwnerId,
        balance: DEFAULT_INITIAL_BALANCE,
        reservedBalance: 0,
        monthlyLimit: DEFAULT_MONTHLY_LIMIT,
        monthlyUsed: 0,
        periodStart,
        periodEnd,
        status: "active",
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  // Check if wallet was just inserted; if so, create initial credit grant transaction record
  if (wallet.balance > 0) {
    const grantKey = `initial_grant_${wallet._id}`;
    try {
      await AiCreditTransaction.create({
        ownerId: normalizedOwnerId,
        walletId: wallet._id,
        type: "credit_grant",
        amount: wallet.balance,
        balanceAfter: wallet.balance,
        description: "Initial complimentary AI credits grant for business owner",
        idempotencyKey: grantKey,
        metadata: { isInitialGrant: true },
      });
    } catch (txErr) {
      // Ignore duplicate key error for initial grant if already logged
      if (txErr.code !== 11000) {
        console.warn("[AI BILLING] Error logging initial grant transaction:", txErr.message);
      }
    }
  }

  // Check if billing period has elapsed and atomically reset monthly usage if needed
  if (wallet.isPeriodExpired()) {
    const { periodStart: newStart, periodEnd: newEnd } = getCalendarMonthPeriod();
    const updated = await AiWallet.findOneAndUpdate(
      {
        _id: wallet._id,
        periodEnd: { $lt: new Date() },
      },
      {
        $set: {
          periodStart: newStart,
          periodEnd: newEnd,
          monthlyUsed: 0,
        },
      },
      { new: true }
    );
    if (updated) {
      wallet = updated;
    }
  }

  return wallet;
};

/**
 * Check AI Credit Balance & Eligibility
 * Fast pre-flight check without reserving or modifying balances.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} [params.ownerId]
 * @param {string|mongoose.Types.ObjectId} [params.storeId]
 * @param {string|mongoose.Types.ObjectId} [params.userId]
 * @returns {Promise<{ allowed: boolean, balance: number, monthlyUsed: number, monthlyLimit: number, monthlyRemaining: number, status: string, reason: string|null }>}
 */
export const checkBalance = async ({
  ownerId = null,
  storeId = null,
  userId = null,
} = {}) => {
  let resolvedOwnerId = toObjectId(ownerId);

  if (!resolvedOwnerId && storeId) {
    const store = await Store.findById(toObjectId(storeId)).select("ownerId");
    if (store?.ownerId) {
      resolvedOwnerId = store.ownerId;
    }
  }

  if (!resolvedOwnerId && userId) {
    const User = mongoose.model("User");
    const user = await User.findById(toObjectId(userId)).select("ownerId role");
    if (user) {
      resolvedOwnerId = user.ownerId || user._id;
    }
  }

  if (!resolvedOwnerId) {
    throw new Error("Unable to resolve ownerId for AI balance check");
  }

  const wallet = await getOrCreateWallet(resolvedOwnerId);

  let allowed = true;
  let reason = null;

  if (wallet.status !== "active") {
    allowed = false;
    reason = "WALLET_INACTIVE";
  } else if (wallet.balance <= 0) {
    allowed = false;
    reason = "INSUFFICIENT_CREDITS";
  } else if (wallet.monthlyUsed >= wallet.monthlyLimit) {
    allowed = false;
    reason = "MONTHLY_LIMIT_EXCEEDED";
  }

  return {
    allowed,
    balance: wallet.balance,
    monthlyUsed: wallet.monthlyUsed,
    monthlyLimit: wallet.monthlyLimit,
    monthlyRemaining: Math.max(0, wallet.monthlyLimit - wallet.monthlyUsed),
    status: wallet.status,
    reason,
  };
};

/**
 * 1.5.B Reserve Credits
 *
 * Atomically reserves credits on the owner's wallet prior to AI execution.
 * Enforces wallet active state, available balance check, monthly usage limit (accounting for
 * active reservations), and prevents duplicate reservations for the same executionId.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.ownerId
 * @param {string|mongoose.Types.ObjectId} [params.storeId]
 * @param {string} params.executionId
 * @param {number} params.credits
 * @param {string} [params.featureName='copilot']
 * @param {Object} [params.metadata={}]
 * @returns {Promise<{ reservation: AiCreditReservation, wallet: AiWallet }>}
 */
export const reserveCredits = async ({
  ownerId,
  storeId = null,
  executionId,
  credits,
  featureName = "copilot",
  metadata = {},
} = {}) => {
  let normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId && storeId) {
    try {
      const store = await Store.findById(toObjectId(storeId));
      if (store && store.owner) {
        normalizedOwnerId = store.owner;
      }
    } catch (err) {
      // Store lookup failed
    }
  }

  if (!normalizedOwnerId) {
    throw new Error("Invalid or missing ownerId for credit reservation");
  }

  if (!executionId || typeof executionId !== "string" || !executionId.trim()) {
    throw new Error("A valid executionId string is required to reserve credits");
  }

  const safeCredits = Number(credits);
  if (!Number.isInteger(safeCredits) || safeCredits <= 0) {
    throw new Error("Reservation credits must be a positive integer greater than zero");
  }

  const maxCap = DEFAULT_PRICING_CONFIG.maxExecutionCharge || 250;
  if (safeCredits > maxCap) {
    throw new Error(`Requested reservation (${safeCredits} credits) exceeds maximum execution cap of ${maxCap} credits`);
  }

  // Idempotency / Duplicate Check on executionId
  const existingReservation = await AiCreditReservation.findOne({ executionId: executionId.trim() });
  if (existingReservation) {
    if (existingReservation.status === "active") {
      throw new Error(`Active reservation already exists for executionId: ${executionId}`);
    }
    throw new Error(`Reservation already processed for executionId: ${executionId} (status: ${existingReservation.status})`);
  }

  // Ensure wallet exists and period is current
  const wallet = await getOrCreateWallet(normalizedOwnerId);

  // Check if wallet is suspended
  if (wallet.status !== "active") {
    throw new Error(`AI credit wallet is currently ${wallet.status}. Contact administrator.`);
  }

  // Atomic reservation using MongoDB $expr to prevent race conditions & overspending:
  // 1. availableBalance >= safeCredits: ($balance - $reservedBalance) >= safeCredits
  // 2. monthlyLimit not exceeded: ($monthlyUsed + $reservedBalance + safeCredits) <= $monthlyLimit
  const updatedWallet = await AiWallet.findOneAndUpdate(
    {
      _id: wallet._id,
      status: "active",
      $expr: {
        $and: [
          { $gte: [{ $subtract: ["$balance", "$reservedBalance"] }, safeCredits] },
          { $lte: [{ $add: ["$monthlyUsed", "$reservedBalance", safeCredits] }, "$monthlyLimit"] },
        ],
      },
    },
    {
      $inc: { reservedBalance: safeCredits },
    },
    { new: true }
  );

  // If atomic update returned null, diagnose the exact reason to provide clean client feedback
  if (!updatedWallet) {
    const current = await AiWallet.findById(wallet._id);
    const available = current ? current.availableBalance : 0;
    const projectedUsage = current ? current.monthlyUsed + current.reservedBalance + safeCredits : 0;

    if (!current || current.status !== "active") {
      throw new Error("AI credit wallet is suspended or unavailable");
    }
    if (available < safeCredits) {
      throw new Error(`Insufficient available AI credits (available: ${available}, required: ${safeCredits})`);
    }
    if (projectedUsage > current.monthlyLimit) {
      throw new Error(
        `Monthly AI usage limit exceeded (limit: ${current.monthlyLimit}, used+reserved: ${current.monthlyUsed + current.reservedBalance}, requested: ${safeCredits})`
      );
    }
    throw new Error("Failed to reserve AI credits due to concurrent wallet activity. Please retry.");
  }

  // Create active reservation record
  const normalizedStoreId = toObjectId(storeId);
  const expiresAt = new Date(Date.now() + DEFAULT_RESERVATION_TTL_MS);

  const reservation = await AiCreditReservation.create({
    ownerId: normalizedOwnerId,
    walletId: updatedWallet._id,
    storeId: normalizedStoreId,
    executionId: executionId.trim(),
    featureName: featureName || "copilot",
    reservedCredits: safeCredits,
    status: "active",
    expiresAt,
    metadata: { ...metadata, featureName },
  });

  // Log reservation transaction in immutable ledger
  await AiCreditTransaction.create({
    ownerId: normalizedOwnerId,
    walletId: updatedWallet._id,
    storeId: normalizedStoreId,
    executionId: executionId.trim(),
    type: "reservation",
    amount: safeCredits,
    balanceAfter: updatedWallet.balance,
    idempotencyKey: `reserve_${executionId.trim()}`,
    description: `Reserved ${safeCredits} credits for AI execution ${executionId}`,
    metadata: { ...metadata, featureName, reservedCredits: safeCredits },
  });

  return { reservation, wallet: updatedWallet };
};

/**
 * 1.5.C Settle Credits
 *
 * Settles an active credit reservation after AI execution completes.
 * Deducts the actual consumed credits from wallet balance, releases unused reserved credits,
 * updates monthly usage, and creates immutable usage transaction records.
 *
 * @param {Object} params
 * @param {string} params.executionId
 * @param {number} params.actualCredits
 * @param {string} [params.idempotencyKey]
 * @param {Object} [params.metadata={}]
 * @returns {Promise<{ reservation: AiCreditReservation, wallet: AiWallet, alreadySettled?: boolean }>}
 */
export const settleCredits = async ({
  executionId,
  actualCredits,
  idempotencyKey = null,
  metadata = {},
} = {}) => {
  if (!executionId || typeof executionId !== "string" || !executionId.trim()) {
    throw new Error("Valid executionId is required for credit settlement");
  }

  const safeActualCredits = Number(actualCredits);
  if (!Number.isInteger(safeActualCredits) || safeActualCredits < 0) {
    throw new Error("Actual credits must be a non-negative integer");
  }

  const reservation = await AiCreditReservation.findOne({ executionId: executionId.trim() });
  if (!reservation) {
    throw new Error(`Reservation not found for executionId: ${executionId}`);
  }

  // Idempotency: Return existing settlement without re-charging
  if (reservation.status === "settled") {
    const wallet = await AiWallet.findById(reservation.walletId);
    return { reservation, wallet, alreadySettled: true };
  }

  if (reservation.status !== "active") {
    throw new Error(`Cannot settle reservation in '${reservation.status}' state`);
  }

  // Apply maximum execution cap to prevent runaway usage
  const maxCap = DEFAULT_PRICING_CONFIG.maxExecutionCharge || 250;
  const billedCredits = Math.min(safeActualCredits, maxCap);

  const reserved = reservation.reservedCredits;
  const released = Math.max(0, reserved - billedCredits);

  // Atomic settlement update on wallet:
  // - Deduct actual consumed credits from balance
  // - Decrement reservedBalance by the entire reserved amount
  // - Increment monthlyUsed by the actual billed credits
  const updatedWallet = await AiWallet.findOneAndUpdate(
    {
      _id: reservation.walletId,
      reservedBalance: { $gte: reserved },
    },
    {
      $inc: {
        balance: -billedCredits,
        reservedBalance: -reserved,
        monthlyUsed: billedCredits,
      },
    },
    { new: true }
  );

  if (!updatedWallet) {
    throw new Error("Failed to settle AI credits: wallet reservation lock mismatch or invalid balance state");
  }

  // Mark reservation as settled
  reservation.status = "settled";
  reservation.consumedCredits = billedCredits;
  reservation.releasedCredits = released;
  reservation.metadata = { ...reservation.metadata, ...metadata, settledAt: new Date() };
  await reservation.save();

  // Create immutable usage charge transaction
  const txIdempotencyKey = idempotencyKey || `settle_${executionId.trim()}`;
  await AiCreditTransaction.create({
    ownerId: reservation.ownerId,
    walletId: reservation.walletId,
    storeId: reservation.storeId,
    executionId: executionId.trim(),
    type: "usage_charge",
    amount: billedCredits,
    balanceAfter: updatedWallet.balance,
    idempotencyKey: txIdempotencyKey,
    description: `Settled ${billedCredits} credits for execution ${executionId}`,
    metadata: {
      ...metadata,
      reservedCredits: reserved,
      consumedCredits: billedCredits,
      releasedCredits: released,
    },
  });

  // If any unused reserved credits were released, log the reservation release in the ledger
  if (released > 0) {
    try {
      await AiCreditTransaction.create({
        ownerId: reservation.ownerId,
        walletId: reservation.walletId,
        storeId: reservation.storeId,
        executionId: executionId.trim(),
        type: "reservation_release",
        amount: released,
        balanceAfter: updatedWallet.balance,
        idempotencyKey: `release_unused_${executionId.trim()}`,
        description: `Released ${released} unused reserved credits for execution ${executionId}`,
        metadata: { executionId: executionId.trim(), releasedCredits: released },
      });
    } catch (relErr) {
      if (relErr.code !== 11000) {
        console.warn("[AI BILLING] Error logging reservation release transaction:", relErr.message);
      }
    }
  }

  return { reservation, wallet: updatedWallet };
};

/**
 * 1.5.D Release Reservation
 *
 * Releases a reserved credit hold in full when an operation cancels, aborts, or errors
 * before consuming billable AI resources.
 *
 * @param {Object} params
 * @param {string} params.executionId
 * @param {string} [params.reason='Operation cancelled or failed']
 * @returns {Promise<{ reservation: AiCreditReservation, wallet: AiWallet, alreadyReleased?: boolean }>}
 */
export const releaseReservation = async ({ executionId, reason = "Operation cancelled or failed" } = {}) => {
  if (!executionId || typeof executionId !== "string" || !executionId.trim()) {
    throw new Error("Valid executionId is required to release reservation");
  }

  const reservation = await AiCreditReservation.findOne({ executionId: executionId.trim() });
  if (!reservation) {
    throw new Error(`Reservation not found for executionId: ${executionId}`);
  }

  // Idempotency: Return existing release without duplicate balance adjustment
  if (reservation.status === "released") {
    const wallet = await AiWallet.findById(reservation.walletId);
    return { reservation, wallet, alreadyReleased: true };
  }

  if (reservation.status !== "active") {
    throw new Error(`Cannot release reservation with status '${reservation.status}'`);
  }

  const reserved = reservation.reservedCredits;

  // Atomically release the reserved balance back to available
  const updatedWallet = await AiWallet.findOneAndUpdate(
    {
      _id: reservation.walletId,
      reservedBalance: { $gte: reserved },
    },
    {
      $inc: { reservedBalance: -reserved },
    },
    { new: true }
  );

  reservation.status = "released";
  reservation.releasedCredits = reserved;
  reservation.consumedCredits = 0;
  reservation.metadata = { ...reservation.metadata, releaseReason: reason, releasedAt: new Date() };
  await reservation.save();

  // Log release transaction in immutable ledger
  await AiCreditTransaction.create({
    ownerId: reservation.ownerId,
    walletId: reservation.walletId,
    storeId: reservation.storeId,
    executionId: executionId.trim(),
    type: "reservation_release",
    amount: reserved,
    balanceAfter: updatedWallet ? updatedWallet.balance : 0,
    idempotencyKey: `release_full_${executionId.trim()}`,
    description: reason || `Released ${reserved} credits for execution ${executionId}`,
    metadata: { executionId: executionId.trim(), reason },
  });

  return { reservation, wallet: updatedWallet };
};

/**
 * 1.5.E Get Usage History
 *
 * Returns recent usage records with date, store, feature, credits consumed, and execution status.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.ownerId
 * @param {string|mongoose.Types.ObjectId} [params.storeId]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @returns {Promise<{ records: Array, total: number, page: number, totalPages: number }>}
 */
export const getUsageHistory = async ({
  ownerId,
  storeId = null,
  page = 1,
  limit = 20,
} = {}) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("ownerId is required to fetch usage history");
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = {
    ownerId: normalizedOwnerId,
    status: { $in: ["settled", "released", "expired"] },
  };

  if (storeId) {
    const normalizedStoreId = toObjectId(storeId);
    if (normalizedStoreId) {
      query.storeId = normalizedStoreId;
    }
  }

  const [records, total] = await Promise.all([
    AiCreditReservation.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("storeId", "name location currency")
      .lean(),
    AiCreditReservation.countDocuments(query),
  ]);

  const formattedRecords = records.map((r) => ({
    id: r._id,
    _id: r._id,
    executionId: r.executionId,
    date: r.createdAt,
    createdAt: r.createdAt,
    settledAt: r.updatedAt || r.createdAt,
    feature: r.featureName || "copilot",
    status: r.status,
    reservedCredits: r.reservedCredits,
    creditsConsumed: r.consumedCredits || 0,
    creditsCharged: r.consumedCredits || 0,
    creditsReleased: r.releasedCredits || 0,
    store: r.storeId
      ? { id: r.storeId._id, name: r.storeId.name, location: r.storeId.location }
      : null,
    metadata: r.metadata,
  }));

  return {
    records: formattedRecords,
    total,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
    page: safePage,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
};

/**
 * Get Transactions
 *
 * Returns paginated immutable credit transaction history for a business owner.
 */
export const getTransactions = async ({
  ownerId,
  type = null,
  page = 1,
  limit = 20,
} = {}) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("ownerId is required to fetch credit transactions");
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const query = { ownerId: normalizedOwnerId };
  if (type) {
    query.type = type;
  }

  const [transactions, total] = await Promise.all([
    AiCreditTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("storeId", "name")
      .lean(),
    AiCreditTransaction.countDocuments(query),
  ]);

  return {
    transactions,
    total,
    page: safePage,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
};

/**
 * Grant or Purchase Credits
 *
 * Adds credits to a business owner's wallet (e.g., top-up purchase or admin grant).
 */
export const grantCredits = async ({
  ownerId,
  amount,
  type = "credit_grant",
  description = "Credit purchase or grant",
  idempotencyKey = null,
  metadata = {},
} = {}) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("Valid ownerId is required to grant credits");
  }

  const safeAmount = Number(amount);
  if (!Number.isInteger(safeAmount) || safeAmount <= 0) {
    throw new Error("Grant amount must be a positive integer");
  }

  const wallet = await getOrCreateWallet(normalizedOwnerId);

  // Atomic balance increment
  const updatedWallet = await AiWallet.findByIdAndUpdate(
    wallet._id,
    { $inc: { balance: safeAmount } },
    { new: true }
  );

  await AiCreditTransaction.create({
    ownerId: normalizedOwnerId,
    walletId: updatedWallet._id,
    type,
    amount: safeAmount,
    balanceAfter: updatedWallet.balance,
    description,
    idempotencyKey: idempotencyKey || `grant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    metadata,
  });

  return updatedWallet;
};

/**
 * 2.5 & 2.8 Record Actual Usage & Settle
 *
 * Called when FastAPI reports normalized usage for an execution.
 * - Validates executionId and reservation.
 * - If already settled, returns existing record (idempotent).
 * - Calculates authoritative customer credits using trusted pricing config and calculateCredits.
 * - Settles reservation atomically.
 * - Stores immutable AiUsageRecord with model breakdown for auditing.
 */
export const recordUsageAndSettle = async ({
  executionId,
  userId = null,
  storeId = null,
  feature = "copilot",
  provider = "default",
  model = "default",
  inputTokens = 0,
  outputTokens = 0,
  audioInputUnits = 0,
  audioOutputUnits = 0,
  voiceDurationSeconds = 0,
  modelBreakdown = [],
  executionStatus = "completed",
  metadata = {},
} = {}) => {
  if (!executionId || typeof executionId !== "string" || !executionId.trim()) {
    throw new Error("Valid executionId is required to record usage and settle");
  }

  const safeExecutionId = executionId.trim();
  const reservation = await AiCreditReservation.findOne({ executionId: safeExecutionId });

  // 1. If reservation exists, settle reservation (backward-compatible with existing tests & flow)
  if (reservation) {
    if (reservation.status === "settled") {
      const existingUsage = await AiUsageRecord.findOne({ executionId: safeExecutionId });
      const wallet = await AiWallet.findById(reservation.walletId);
      return {
        usageRecord: existingUsage,
        reservation,
        wallet,
        alreadySettled: true,
        creditsCharged: reservation.consumedCredits || 0,
        remainingBalance: wallet ? wallet.balance : 0,
        isExhausted: wallet ? wallet.balance <= 0 || wallet.monthlyUsed >= wallet.monthlyLimit : false,
      };
    }

    // Authoritative credit calculation on Express using configured rates
    const pricingConfig = await resolvePricingConfig({
      featureName: feature,
      provider,
      model,
    });

    const totalCalls = Array.isArray(modelBreakdown)
      ? modelBreakdown.reduce((sum, b) => sum + (Number(b.callCount) || 1), 0)
      : 0;

    const { credits, tokenCredits, audioCredits, voiceCredits } = calculateCredits({
      inputTokens,
      outputTokens,
      audioInputUnits,
      audioOutputUnits,
      voiceDurationSeconds,
      callCount: totalCalls,
      config: pricingConfig,
    });

    // Perform atomic settlement on the customer's wallet
    const settlementResult = await settleCredits({
      executionId: safeExecutionId,
      actualCredits: credits,
      idempotencyKey: `settle_usage_${safeExecutionId}`,
      metadata: {
        ...metadata,
        feature,
        provider,
        model,
        inputTokens,
        outputTokens,
        tokenCredits,
        audioCredits,
        voiceCredits,
        pricingVersion: pricingConfig.pricingVersion || 1,
      },
    });

    // Store audited usage record
    const usageRecord = await AiUsageRecord.findOneAndUpdate(
      { executionId: safeExecutionId },
      {
        $setOnInsert: {
          ownerId: reservation.ownerId,
          userId: toObjectId(userId) || reservation.ownerId,
          storeId: toObjectId(storeId) || reservation.storeId,
          executionId: safeExecutionId,
          feature,
          provider,
          model,
          modelBreakdown: Array.isArray(modelBreakdown) ? modelBreakdown : [],
          inputTokens: Math.max(0, Number(inputTokens) || 0),
          outputTokens: Math.max(0, Number(outputTokens) || 0),
          totalTokens: Math.max(0, Number(inputTokens) || 0) + Math.max(0, Number(outputTokens) || 0),
          audioInputUnits: Math.max(0, Number(audioInputUnits) || 0),
          audioOutputUnits: Math.max(0, Number(audioOutputUnits) || 0),
          creditsCharged: settlementResult.reservation.consumedCredits,
          pricingVersion: pricingConfig.pricingVersion || 1,
          executionStatus: executionStatus || "completed",
          metadata,
          settledAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    const isExhausted =
      settlementResult.wallet.balance <= 0 ||
      settlementResult.wallet.monthlyUsed >= settlementResult.wallet.monthlyLimit;

    return {
      usageRecord,
      reservation: settlementResult.reservation,
      wallet: settlementResult.wallet,
      creditsCharged: settlementResult.reservation.consumedCredits,
      remainingBalance: settlementResult.wallet.balance,
      isExhausted,
    };
  }

  // 2. Direct Stage Deduction / Non-reserved settlement
  const existingUsage = await AiUsageRecord.findOne({ executionId: safeExecutionId });

  // Resolve billable owner
  let resolvedOwnerId = toObjectId(metadata?.ownerId || metadata?.billableOwnerId);
  if (!resolvedOwnerId && storeId) {
    const store = await Store.findById(toObjectId(storeId)).select("ownerId");
    if (store?.ownerId) resolvedOwnerId = store.ownerId;
  }
  if (!resolvedOwnerId && userId) {
    const User = mongoose.model("User");
    const user = await User.findById(toObjectId(userId)).select("ownerId");
    if (user) resolvedOwnerId = user.ownerId || user._id;
  }
  if (!resolvedOwnerId && existingUsage) {
    resolvedOwnerId = existingUsage.ownerId;
  }

  if (!resolvedOwnerId) {
    throw new Error(`Active credit reservation not found and cannot resolve owner for executionId: ${executionId}`);
  }

  const wallet = await getOrCreateWallet(resolvedOwnerId);

  const pricingConfig = await resolvePricingConfig({
    featureName: feature,
    provider,
    model,
  });

  const isStageDeduction = Boolean(metadata?.isStageDeduction);
  let billableInputTokens = Math.max(0, Number(inputTokens) || 0);
  let billableOutputTokens = Math.max(0, Number(outputTokens) || 0);
  let billableAudioIn = Math.max(0, Number(audioInputUnits) || 0);
  let billableAudioOut = Math.max(0, Number(audioOutputUnits) || 0);

  // If cumulative summary was reported at completion without isStageDeduction flag, compute delta from existing
  if (!isStageDeduction && existingUsage) {
    billableInputTokens = Math.max(0, billableInputTokens - (existingUsage.inputTokens || 0));
    billableOutputTokens = Math.max(0, billableOutputTokens - (existingUsage.outputTokens || 0));
    billableAudioIn = Math.max(0, billableAudioIn - (existingUsage.audioInputUnits || 0));
    billableAudioOut = Math.max(0, billableAudioOut - (existingUsage.audioOutputUnits || 0));
  }

  const totalCalls = Array.isArray(modelBreakdown)
    ? modelBreakdown.reduce((sum, b) => sum + (Number(b.callCount) || 1), 0)
    : 0;

  // If zero delta tokens/audio and record exists, simply update execution status
  if (
    billableInputTokens === 0 &&
    billableOutputTokens === 0 &&
    billableAudioIn === 0 &&
    billableAudioOut === 0 &&
    totalCalls === 0
  ) {
    if (existingUsage) {
      existingUsage.executionStatus = executionStatus || existingUsage.executionStatus;
      await existingUsage.save();
      return {
        usageRecord: existingUsage,
        wallet,
        creditsCharged: 0,
        remainingBalance: wallet.balance,
        isExhausted: wallet.balance <= 0 || wallet.monthlyUsed >= wallet.monthlyLimit,
      };
    }
  }

  const { credits, tokenCredits, audioCredits, voiceCredits } = calculateCredits({
    inputTokens: billableInputTokens,
    outputTokens: billableOutputTokens,
    audioInputUnits: billableAudioIn,
    audioOutputUnits: billableAudioOut,
    voiceDurationSeconds,
    callCount: totalCalls,
    config: pricingConfig,
  });

  const maxCap = pricingConfig.maxExecutionCharge || 250;
  const billedCredits = Math.min(credits, maxCap);

  // Deduct from wallet balance safely (clamp to balance so it doesn't violate min: 0 schema validator)
  const deduction = Math.max(0, Math.min(wallet.balance, billedCredits));
  let updatedWallet = await AiWallet.findOneAndUpdate(
    { _id: wallet._id, balance: { $gte: deduction } },
    {
      $inc: {
        balance: -deduction,
        monthlyUsed: deduction,
      },
    },
    { new: true }
  );

  if (!updatedWallet) {
    const fresh = await AiWallet.findById(wallet._id);
    const freshDeduction = Math.max(0, Math.min(fresh ? fresh.balance : 0, billedCredits));
    updatedWallet = await AiWallet.findByIdAndUpdate(
      wallet._id,
      {
        $inc: {
          balance: -freshDeduction,
          monthlyUsed: freshDeduction,
        },
      },
      { new: true }
    );
  }

  // Create immutable transaction ledger record if credits were billed
  const stageName = metadata?.stageName || `stage_${Date.now()}`;
  const txIdempotencyKey = `stage_${safeExecutionId}_${stageName}`;

  if (billedCredits > 0) {
    try {
      await AiCreditTransaction.create({
        ownerId: resolvedOwnerId,
        walletId: updatedWallet._id,
        storeId: toObjectId(storeId),
        executionId: safeExecutionId,
        type: "usage_charge",
        amount: billedCredits,
        balanceAfter: updatedWallet.balance,
        idempotencyKey: txIdempotencyKey,
        description: `Deducted ${billedCredits} credits for ${feature} execution ${safeExecutionId} (${stageName})`,
        metadata: {
          ...metadata,
          feature,
          provider,
          model,
          inputTokens: billableInputTokens,
          outputTokens: billableOutputTokens,
          tokenCredits,
          audioCredits,
          voiceCredits,
          pricingVersion: pricingConfig.pricingVersion || 1,
        },
      });
    } catch (txErr) {
      console.warn("[AI BILLING] Stage transaction ledger write note:", txErr.message);
    }
  }

  // Upsert AiUsageRecord
  const usageRecord = await AiUsageRecord.findOneAndUpdate(
    { executionId: safeExecutionId },
    {
      $setOnInsert: {
        ownerId: resolvedOwnerId,
        userId: toObjectId(userId) || resolvedOwnerId,
        storeId: toObjectId(storeId),
        executionId: safeExecutionId,
        feature,
        provider,
        model,
        pricingVersion: pricingConfig.pricingVersion || 1,
        settledAt: new Date(),
      },
      $set: {
        executionStatus: executionStatus || "completed",
        updatedAt: new Date(),
        metadata,
      },
      $inc: {
        inputTokens: billableInputTokens,
        outputTokens: billableOutputTokens,
        totalTokens: billableInputTokens + billableOutputTokens,
        audioInputUnits: billableAudioIn,
        audioOutputUnits: billableAudioOut,
        creditsCharged: billedCredits,
      },
    },
    { upsert: true, new: true }
  );

  const isExhausted =
    updatedWallet.balance <= 0 ||
    updatedWallet.monthlyUsed >= updatedWallet.monthlyLimit;

  return {
    usageRecord,
    wallet: updatedWallet,
    creditsCharged: billedCredits,
    remainingBalance: updatedWallet.balance,
    isExhausted,
  };
};

/**
 * 3.6 Update Business Owner Wallet Settings (Administrative Control)
 *
 * Allows store owners to update their account-wide monthly AI limit.
 * Values are strictly validated on the server to prevent manipulation.
 */
export const updateWalletSettings = async ({
  ownerId,
  monthlyLimit,
} = {}) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("Invalid or missing ownerId");
  }

  const wallet = await getOrCreateWallet(normalizedOwnerId);

  const updates = {};
  if (monthlyLimit !== undefined) {
    const limitNum = Number(monthlyLimit);
    if (!Number.isInteger(limitNum) || limitNum < 100 || limitNum > 100000) {
      throw new Error("Monthly limit must be an integer between 100 and 100,000 credits");
    }
    updates.monthlyLimit = limitNum;
  }

  const updatedWallet = await AiWallet.findByIdAndUpdate(
    wallet._id,
    { $set: updates },
    { new: true }
  );

  return updatedWallet;
};

/**
 * 3.7 Top-Up Packages and Razorpay Payment Integration
 */
export const TOP_UP_PACKAGES = {
  starter: {
    id: "starter",
    name: "Starter Booster",
    credits: 1000,
    priceInr: 199,
    description: "1,000 AI Credits (~300 copilot queries or 1,000s voice)",
  },
  growth: {
    id: "growth",
    name: "Growth Booster",
    credits: 5000,
    priceInr: 799,
    description: "5,000 AI Credits (high-volume multi-store queries)",
  },
  pro: {
    id: "pro",
    name: "Pro Enterprise Booster",
    credits: 10000,
    priceInr: 1299,
    description: "10,000 AI Credits (unlimited daily retail automation)",
  },
};

/**
 * Creates an order reference for Razorpay checkout
 */
export const createTopUpOrder = async ({ ownerId, packageId }) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("Invalid ownerId");
  }

  const pkg = TOP_UP_PACKAGES[packageId];
  if (!pkg) {
    throw new Error(`Invalid top-up package: '${packageId}'. Must be one of: starter, growth, pro`);
  }

  const orderId = `order_ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const keyId = process.env.RAZORPAY_KEY_ID || "rzp_test_mock_mode";

  return {
    orderId,
    packageId: pkg.id,
    packageName: pkg.name,
    credits: pkg.credits,
    amount: pkg.priceInr * 100, // Amount in paise
    currency: "INR",
    keyId,
    description: `Purchase ${pkg.credits.toLocaleString()} AI Credits for Vyapar Sathi`,
  };
};

/**
 * Verifies Razorpay signature and applies credits atomically with idempotency.
 */
export const verifyAndApplyTopUp = async ({
  ownerId,
  orderId,
  paymentId,
  signature,
  packageId,
} = {}) => {
  const normalizedOwnerId = toObjectId(ownerId);
  if (!normalizedOwnerId) {
    throw new Error("Invalid ownerId");
  }

  if (!paymentId || !orderId) {
    throw new Error("Missing required paymentId or orderId");
  }

  const pkg = TOP_UP_PACKAGES[packageId];
  if (!pkg) {
    throw new Error(`Invalid packageId '${packageId}'`);
  }

  // Idempotency: check if paymentId already processed in ledger
  const existingTx = await AiCreditTransaction.findOne({ idempotencyKey: paymentId });
  if (existingTx) {
    const wallet = await getOrCreateWallet(normalizedOwnerId);
    return {
      success: true,
      alreadyProcessed: true,
      creditsGranted: existingTx.amount,
      wallet,
      transaction: existingTx,
    };
  }

  // Verify HMAC SHA256 signature if secret is configured
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  if (razorpaySecret) {
    const generatedSignature = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    if (generatedSignature !== signature) {
      throw new Error("Invalid Razorpay payment signature verification failed");
    }
  }

  // Apply credits atomically via grantCredits
  const result = await grantCredits({
    ownerId: normalizedOwnerId,
    amount: pkg.credits,
    description: `Razorpay Payment Top-Up: ${pkg.name} (${pkg.credits} credits)`,
    idempotencyKey: paymentId,
    metadata: {
      orderId,
      paymentId,
      packageId: pkg.id,
      priceInr: pkg.priceInr,
      verifiedAt: new Date(),
    },
  });

  return {
    success: true,
    creditsGranted: pkg.credits,
    wallet: result.wallet,
    transaction: result.transaction,
  };
};


