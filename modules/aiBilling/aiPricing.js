import AiPricingConfig from "../../models/aiPricingConfig.model.js";

/**
 * DEFAULT_PRICING_CONFIG
 *
 * Configurable development placeholder rates.
 * Note: These represent initial placeholder rates, NOT actual third-party provider costs.
 * Convention:
 * - inputTokenCreditRate: credits per 1,000 input tokens.
 * - outputTokenCreditRate: credits per 1,000 output tokens.
 * - audioInputRate: credits per input unit (e.g. per second).
 * - audioOutputRate: credits per output unit (e.g. per second).
 * - voiceDurationRate: credits per duration unit.
 */
export const DEFAULT_PRICING_CONFIG = {
  featureName: "default",
  provider: "default",
  model: "default",
  inputTokenCreditRate: 2, // Baseline development rate for small tests
  outputTokenCreditRate: 6,
  audioInputRate: 1,
  audioOutputRate: 2,
  voiceDurationRate: 0,
  minCharge: 1, // At least 1 credit per execution
  maxExecutionCharge: 250, // Absolute ceiling to protect customer wallets
  pricingVersion: 1,
  isActive: true,
};

/**
 * Resolves pricing configuration for a given feature, provider, and model.
 * Looks for exact match in MongoDB first, falling back to model-calibrated defaults or static defaults.
 */
export const resolvePricingConfig = async ({
  featureName = "default",
  provider = "default",
  model = "default",
} = {}) => {
  try {
    const config = await AiPricingConfig.findOne({
      isActive: true,
      $or: [
        { featureName, provider, model },
        { featureName, provider, model: "default" },
        { featureName, provider: "default", model: "default" },
        { featureName: "default", provider: "default", model: "default" },
      ],
    }).sort({
      // Prefer exact model match over generic defaults
      model: model !== "default" ? -1 : 1,
      provider: provider !== "default" ? -1 : 1,
      featureName: featureName !== "default" ? -1 : 1,
      pricingVersion: -1,
    });

    if (config) {
      return typeof config.toObject === "function" ? config.toObject() : config;
    }
  } catch (err) {
    console.warn("[AI PRICING] Error resolving DB pricing config, using defaults:", err.message);
  }

  const provLower = (provider || "").toLowerCase();
  const modLower = (model || "").toLowerCase();

  // Calibrated production rates for high-context models (Gemini Flash)
  // Ensures 40k+ token queries cost 2-4 credits instead of 90+ credits
  if (provLower === "gemini" || modLower.includes("gemini") || modLower.includes("flash")) {
    return {
      ...DEFAULT_PRICING_CONFIG,
      featureName,
      provider,
      model,
      inputTokenCreditRate: 0.05, // 0.05 credits per 1,000 input tokens (1 credit per 20,000 tokens)
      outputTokenCreditRate: 0.15, // 0.15 credits per 1,000 output tokens (1 credit per 6,666 tokens)
      audioInputRate: 0.05, // ~3 credits per minute
      audioOutputRate: 0.10, // ~6 credits per minute
      maxExecutionCharge: 50,
    };
  }

  return { ...DEFAULT_PRICING_CONFIG, featureName, provider, model };
};

/**
 * Calculates credit consumption for an AI execution using reported token & audio usage.
 *
 * Formula:
 *   tokenCredits = ceil((inputTokens * inputRate + outputTokens * outputRate) / 1000)
 *   audioCredits = ceil(audioInputUnits * audioInputRate + audioOutputUnits * audioOutputRate)
 *   voiceCredits = ceil(voiceDurationSeconds * voiceDurationRate)
 *   totalCredits = clamp(tokenCredits + audioCredits + voiceCredits, minCharge, maxExecutionCharge)
 *
 * @param {Object} params
 * @param {number} [params.inputTokens=0]
 * @param {number} [params.outputTokens=0]
 * @param {number} [params.audioInputUnits=0]
 * @param {number} [params.audioOutputUnits=0]
 * @param {number} [params.voiceDurationSeconds=0]
 * @param {Object} [params.config] - Optional pre-resolved pricing configuration
 * @returns {{ credits: number, tokenCredits: number, audioCredits: number, voiceCredits: number, pricingVersion: number }}
 */
export const calculateCredits = ({
  inputTokens = 0,
  outputTokens = 0,
  audioInputUnits = 0,
  audioOutputUnits = 0,
  voiceDurationSeconds = 0,
  callCount = 0,
  config = DEFAULT_PRICING_CONFIG,
} = {}) => {
  const cfg = { ...DEFAULT_PRICING_CONFIG, ...config };

  const safeInputTokens = Math.max(0, Number(inputTokens) || 0);
  const safeOutputTokens = Math.max(0, Number(outputTokens) || 0);
  const safeAudioIn = Math.max(0, Number(audioInputUnits) || 0);
  const safeAudioOut = Math.max(0, Number(audioOutputUnits) || 0);
  const safeVoiceSec = Math.max(0, Number(voiceDurationSeconds) || 0);
  const safeCallCount = Math.max(0, Number(callCount) || 0);

  // Token credits (rates represent credits per 1,000 tokens)
  const tokenCost =
    safeInputTokens * (cfg.inputTokenCreditRate || 0) +
    safeOutputTokens * (cfg.outputTokenCreditRate || 0);
  const tokenCredits = tokenCost > 0 ? Math.ceil(tokenCost / 1000) : 0;

  // Audio credits (clean interface for future voice/audio metering)
  const audioCost =
    safeAudioIn * (cfg.audioInputRate || 0) + safeAudioOut * (cfg.audioOutputRate || 0);
  const audioCredits = audioCost > 0 ? Math.ceil(audioCost) : 0;

  // Voice duration-based credits
  const voiceCredits =
    safeVoiceSec > 0 && cfg.voiceDurationRate > 0
      ? Math.ceil(safeVoiceSec * cfg.voiceDurationRate)
      : 0;

  let rawTotal = tokenCredits + audioCredits + voiceCredits;

  // If operation took place, ensure minimum charge is applied
  if (
    rawTotal > 0 ||
    safeInputTokens > 0 ||
    safeOutputTokens > 0 ||
    safeAudioIn > 0 ||
    safeAudioOut > 0 ||
    safeVoiceSec > 0 ||
    safeCallCount > 0
  ) {
    rawTotal = Math.max(rawTotal, cfg.minCharge || 1);
  }

  // Enforce ceiling to protect against runaway charges
  const finalCredits = Math.min(rawTotal, cfg.maxExecutionCharge || 250);

  return {
    credits: finalCredits,
    tokenCredits,
    audioCredits,
    voiceCredits,
    pricingVersion: cfg.pricingVersion || 1,
  };
};

