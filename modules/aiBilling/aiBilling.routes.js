import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import {
  getWalletController,
  getUsageController,
  getTransactionsController,
  getPricingController,
  internalReserveController,
  internalSettleController,
  internalReleaseController,
  internalReportUsageController,
} from "./aiBilling.controller.js";

const router = Router();

/**
 * Middleware ensuring only trusted internal service callers can execute
 * direct balance reservation/settlement/release HTTP endpoints.
 */
const requireInternalAuth = (req, res, next) => {
  const internalKey = process.env.INTERNAL_SERVICE_KEY || "vyapar-internal-ai-service-key";
  const headerKey = req.headers["x-internal-service-key"];
  const serviceName = req.headers["x-service-name"];

  if (
    req.isInternalService ||
    headerKey === internalKey ||
    serviceName === "vyapar-ai-service"
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Access Denied: Internal billing operations require trusted service authorization",
    statusCode: 403,
  });
};

// All public AI billing endpoints require user authentication
router.use(authMiddleware);

// Public authenticated endpoints for merchants and store staff
router.get("/wallet", requireUser, getWalletController);
router.get("/usage", requireUser, getUsageController);
router.get("/transactions", requireUser, getTransactionsController);
router.get("/pricing", requireUser, getPricingController);

// Internal service-to-service endpoints
router.post("/internal/reserve", requireInternalAuth, internalReserveController);
router.post("/internal/settle", requireInternalAuth, internalSettleController);
router.post("/internal/release", requireInternalAuth, internalReleaseController);
router.post("/internal/report-usage", requireInternalAuth, internalReportUsageController);

export default router;

