import { Router } from "express";
import dotenv from "dotenv";
dotenv.config();
import { createProxyMiddleware } from "http-proxy-middleware";
import mongoose from "mongoose";

import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import { Store, Employee, User, AiCreditReservation } from "../../models/index.js";
import * as aiBillingService from "../aiBilling/aiBilling.service.js";
import { ALL_PERMISSIONS } from "../../utils/permissions.js";

import http from "http";
import https from "https";

const router = Router();


// ============================================================================
// Authentication & Store Context Resolution
// ============================================================================

router.use(authMiddleware);
router.use(requireUser);

/**
 * AI Store Context Resolution Middleware
 * Resolves user membership (Owner or Employee), injects role and permissions,
 * checks store-level AI subscription quota, and attaches forwarded headers.
 */
const resolveAiStoreContext = async (req, res, next) => {
  try {
    let storeId =
      req.params?.storeId ||
      req.query?.storeId ||
      req.headers?.["x-store-id"] ||
      req.body?.storeId ||
      req.body?.store;

    if (!storeId && req.originalUrl) {
      const match = req.originalUrl.match(/^\/api\/ai\/([^/?#]+)/);
      if (match && match[1] && mongoose.Types.ObjectId.isValid(match[1])) {
        storeId = match[1];
      }
    }

    // Pass through if request is not store-scoped
    if (!storeId) {
      return next();
    }

    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid store ID format",
        statusCode: 400,
      });
    }

    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User context missing",
        statusCode: 401,
      });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
        statusCode: 404,
      });
    }

    const storeOwnerId = store.owner?._id ? store.owner._id.toString() : store.owner?.toString();
    const currentUserId = userId.toString();
    const currentStoreId = store._id.toString();

    let authContext = null;

    if (storeOwnerId === currentUserId) {
      // User is the Store Owner
      authContext = {
        storeId: currentStoreId,
        userId: currentUserId,
        membershipType: "owner",
        isOwner: true,
        roleName: "Owner",
        permissions: ALL_PERMISSIONS,
      };
    } else {
      // Check active employee membership
      const employee = await Employee.findOne({
        store: store._id,
        user: userId,
        status: "active",
      }).populate("role");

      if (!employee || !employee.role) {
        return res.status(403).json({
          success: false,
          message: "Access Denied: You do not have permission to access this store workspace AI.",
          statusCode: 403,
        });
      }

      authContext = {
        storeId: currentStoreId,
        userId: currentUserId,
        membershipType: "employee",
        isOwner: false,
        roleName: employee.role.name || "Employee",
        permissions: Array.isArray(employee.role.permissions) ? employee.role.permissions : [],
      };
    }

    // Resolve the billable store owner's account
    const billableOwner = authContext.isOwner
      ? req.user
      : await User.findById(store.owner);

    if (!billableOwner) {
      return res.status(404).json({
        success: false,
        message: "Store owner account not found",
        statusCode: 404,
      });
    }

    // Identify if this is a billable AI endpoint (e.g. copilot stream or clarify)
    const isBillableAiRoute =
      req.originalUrl.includes("/copilot") || req.originalUrl.includes("/clarify");

    let executionId = null;

    if (isBillableAiRoute) {
      // 2.1 Identify or reuse execution ID:
      // If client responds to a clarification prompt, reuse the existing executionId without re-charging a fixed fee
      executionId =
        req.headers["x-execution-id"] ||
        req.body?.executionId ||
        req.body?.execution_id ||
        null;

      if (!executionId) {
        executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      }

      // Pre-flight balance gate check (Direct stage-deduction model: no rigid 25-credit buffer required)
      const wallet = await aiBillingService.getOrCreateWallet(billableOwner._id);
      if (wallet.status !== "active") {
        return res.status(403).json({
          success: false,
          code: "WALLET_INACTIVE",
          message: "AI credit wallet is inactive. Please contact support.",
          statusCode: 403,
        });
      }

      if (wallet.balance <= 0) {
        const quotaMessage = authContext.isOwner
          ? "You have 0 AI credits remaining. Please recharge your wallet in Settings."
          : "Store owner's account has 0 AI credits remaining. Please contact the store owner.";
        return res.status(402).json({
          success: false,
          code: "INSUFFICIENT_CREDITS",
          message: quotaMessage,
          statusCode: 402,
        });
      }

      if (wallet.monthlyUsed >= wallet.monthlyLimit) {
        return res.status(402).json({
          success: false,
          code: "MONTHLY_LIMIT_EXCEEDED",
          message: "Monthly AI usage limit reached. Please recharge or upgrade your plan in Settings.",
          statusCode: 402,
        });
      }
    }

    req.store = store;
    req.authContext = authContext;
    req.executionId = executionId;
    req.billableOwner = billableOwner;
    req.aiHeaders = {
      "x-store-id": authContext.storeId,
      "x-user-id": authContext.userId,
      "x-is-owner": authContext.isOwner ? "true" : "false",
      "x-user-role": authContext.roleName,
      "x-user-permissions": authContext.permissions.join(","),
      ...(executionId ? { "x-execution-id": executionId } : {}),
      "x-owner-id": billableOwner._id.toString(),
    };

    next();
  } catch (err) {
    console.error("[AI AUTH] Error resolving AI store context:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to resolve store AI authorization",
      statusCode: 500,
    });
  }
};

router.use(resolveAiStoreContext);


// ============================================================================
// FastAPI Service URL
//
// Local:
//   http://127.0.0.1:8080
//
// Render:
//   https://your-fastapi-service.onrender.com
// ============================================================================

const FASTAPI_URL =
  process.env.AI_SERVICE_URL ||
  "http://127.0.0.1:8080";


// Validate URL during startup

const fastApiTargetUrl = new URL(FASTAPI_URL);

console.log("[AI PROXY] FastAPI target:", {
  protocol: fastApiTargetUrl.protocol,
  hostname: fastApiTargetUrl.hostname,
  port:
    fastApiTargetUrl.port ||
    (fastApiTargetUrl.protocol === "https:"
      ? "443"
      : "80"),
});


// ============================================================================
// Regular HTTP Proxy
// ============================================================================

const aiProxy = createProxyMiddleware({

  target: FASTAPI_URL,

  changeOrigin: true,

  pathRewrite: {
    "^/api/ai": "",
  },

  on: {

    proxyReq: (proxyReq, req) => {

      if (req.user) {

        proxyReq.setHeader(
          "x-user-id",
          req.user._id.toString()
        );

      }

      if (req.aiHeaders) {
        proxyReq.setHeader("x-store-id", req.aiHeaders["x-store-id"]);
        proxyReq.setHeader("x-is-owner", req.aiHeaders["x-is-owner"]);
        proxyReq.setHeader("x-user-role", req.aiHeaders["x-user-role"]);
        proxyReq.setHeader("x-user-permissions", req.aiHeaders["x-user-permissions"]);
      }

    },

    error: (err, req, res) => {

      console.error(
        "[AI PROXY] FastAPI request failed:",
        err.message
      );

    },

  },

});


// ============================================================================
// SSE Streaming Proxy
// ============================================================================

const sseProxy = async (req, res) => {

  // --------------------------------------------------------------------------
  // Parse FastAPI target
  // --------------------------------------------------------------------------

  const targetUrl = new URL(FASTAPI_URL);


  // --------------------------------------------------------------------------
  // Build forwarded path
  //
  // Example:
  //
  // Incoming:
  //   /api/ai/store123/copilot/stream
  //
  // Forwarded:
  //   /store123/copilot/stream
  // --------------------------------------------------------------------------

  const forwardPath =
    req.originalUrl.replace(
      /^\/api\/ai/,
      ""
    );


  // --------------------------------------------------------------------------
  // Select correct protocol
  //
  // Render:
  //
  // https://service.onrender.com
  //       ↓
  // https module
  //       ↓
  // port 443
  //
  // Local:
  //
  // http://127.0.0.1:8080
  //       ↓
  // http module
  //       ↓
  // port 8080
  // --------------------------------------------------------------------------

  const isHttps =
    targetUrl.protocol === "https:";


  const protocol =
    isHttps
      ? https
      : http;


  const port =
    targetUrl.port
      ? Number(targetUrl.port)
      : isHttps
        ? 443
        : 80;


  // --------------------------------------------------------------------------
  // Prepare request body
  // --------------------------------------------------------------------------

  const bodyObj = { ...(req.body || {}) };
  if (req.executionId && !bodyObj.execution_id && !bodyObj.executionId) {
    bodyObj.execution_id = req.executionId;
  }
  const body = JSON.stringify(bodyObj);


  // --------------------------------------------------------------------------
  // Request options
  // --------------------------------------------------------------------------

  const headers = {
    "Content-Type":
      "application/json",

    "Content-Length":
      Buffer.byteLength(body),

    "Accept":
      "text/event-stream",

    "x-user-id":
      req.user
        ? req.user._id.toString()
        : "",
  };

  if (req.aiHeaders) {
    Object.assign(headers, req.aiHeaders);
  }

  const options = {

    hostname: targetUrl.hostname,

    port,

    path: forwardPath,

    method: "POST",

    headers,

  };


  console.log(
    "[SSE PROXY] Forwarding request:",
    {
      protocol:
        targetUrl.protocol,

      hostname:
        targetUrl.hostname,

      port,

      path:
        forwardPath,
    }
  );


  // --------------------------------------------------------------------------
  // Create upstream request
  // --------------------------------------------------------------------------

  const proxyReq = protocol.request(
    options,

    (proxyRes) => {


      console.log(
        "[SSE PROXY] FastAPI response:",
        {
          statusCode:
            proxyRes.statusCode,

          contentType:
            proxyRes.headers["content-type"],
        }
      );


      // ----------------------------------------------------------------------
      // FastAPI returned an error
      // ----------------------------------------------------------------------

      if (
        !proxyRes.statusCode ||
        proxyRes.statusCode >= 400
      ) {

        let errorBody = "";

        proxyRes.on(
          "data",
          (chunk) => {

            errorBody +=
              chunk.toString();

          }
        );

        proxyRes.on(
          "end",
          () => {

            console.error(
              "[SSE PROXY] FastAPI error:",
              {
                statusCode:
                  proxyRes.statusCode,

                body:
                  errorBody,
              }
            );

            // Release any reserved credits since execution failed
            if (req.executionId) {
              aiBillingService.releaseReservation({
                executionId: req.executionId,
                reason: `FastAPI error response: ${proxyRes.statusCode}`,
              }).catch((err) => {
                console.warn("[AI BILLING] Error releasing reservation on upstream error:", err.message);
              });
            }

            // Send SSE error event

            res.setHeader(
              "Content-Type",
              "text/event-stream"
            );

            res.write(
              `event: error\n` +
              `data: ${JSON.stringify({
                message:
                  "FastAPI service returned an error",

                status:
                  proxyRes.statusCode,
              })}\n\n`
            );

            res.end();

          }
        );

        return;

      }


      // ----------------------------------------------------------------------
      // Forward SSE headers
      // ----------------------------------------------------------------------

      res.status(
        proxyRes.statusCode || 200
      );


      res.setHeader(
        "Content-Type",
        "text/event-stream"
      );


      res.setHeader(
        "Cache-Control",
        "no-cache, no-transform"
      );


      res.setHeader(
        "Connection",
        "keep-alive"
      );


      res.setHeader(
        "X-Accel-Buffering",
        "no"
      );


      // Flush headers before streaming

      res.flushHeaders();


      // ----------------------------------------------------------------------
      // Forward FastAPI stream and intercept usage event for billing settlement
      // ----------------------------------------------------------------------

      let sseBuffer = "";
      let isUsageSettled = false;

      proxyRes.on("data", async (chunk) => {
        try {
          sseBuffer += chunk.toString("utf8");

          // Look for event: usage in accumulated SSE buffer
          if (sseBuffer.includes("event: usage")) {
            const usageMatch = sseBuffer.match(/event:\s*usage\s*\ndata:\s*(\{.*?\})\n/s);
            if (usageMatch && !isUsageSettled && req.executionId) {
              isUsageSettled = true;
              try {
                const usageData = JSON.parse(usageMatch[1]);
                await aiBillingService.recordUsageAndSettle({
                  executionId: req.executionId,
                  ownerId: req.billableOwner?._id,
                  userId: req.user?._id || req.authContext?.userId,
                  storeId: req.authContext?.storeId,
                  feature: "copilot",
                  provider: usageData.provider || "groq",
                  model: usageData.model || "unknown",
                  modelBreakdown: usageData.modelBreakdown || usageData.breakdown || [],
                  inputTokens: usageData.inputTokens || usageData.input_tokens || 0,
                  outputTokens: usageData.outputTokens || usageData.output_tokens || 0,
                  audioInputUnits: usageData.audioInputUnits || usageData.audio_input_seconds || 0,
                  audioOutputUnits: usageData.audioOutputUnits || usageData.audio_output_seconds || 0,
                  executionStatus: usageData.executionStatus || "completed",
                });
              } catch (settleErr) {
                console.error("[SSE PROXY] Usage settlement failed in stream proxy:", settleErr.message);
              }
            }
          }
        } catch (bufErr) {
          console.warn("[SSE PROXY] Buffer parsing error:", bufErr.message);
        }
      });

      proxyRes.pipe(res);

      proxyRes.on("end", async () => {
        // If stream finished without an event: usage, release unused reservation
        if (!isUsageSettled && req.executionId) {
          try {
            await aiBillingService.releaseReservation({
              executionId: req.executionId,
              reason: "Stream closed without usage event",
            });
          } catch (relErr) {
            // Already settled or released
          }
        }
      });


      // ----------------------------------------------------------------------
      // Handle upstream errors
      // ----------------------------------------------------------------------

      proxyRes.on(
        "error",

        (err) => {

          console.error(
            "[SSE PROXY] FastAPI stream error:",
            err.message
          );

          if (req.executionId && !isUsageSettled) {
            aiBillingService.releaseReservation({
              executionId: req.executionId,
              reason: `FastAPI stream error: ${err.message}`,
            }).catch(() => {});
          }

          if (!res.writableEnded) {

            res.end();

          }

        }

      );


    }
  );


  // ==========================================================================
  // Upstream connection error
  // ==========================================================================

  proxyReq.on(
    "error",

    (err) => {

      console.error(
        "[SSE PROXY] Request to FastAPI failed:",
        err
      );

      if (req.executionId) {
        aiBillingService.releaseReservation({
          executionId: req.executionId,
          reason: `Upstream connection failure: ${err.message}`,
        }).catch(() => {});
      }

      if (!res.headersSent) {

        res.setHeader(
          "Content-Type",
          "text/event-stream"
        );

        res.setHeader(
          "Cache-Control",
          "no-cache"
        );

        res.flushHeaders();

      }


      if (!res.writableEnded) {

        res.write(
          `event: error\n` +
          `data: ${JSON.stringify({
            message:
              "Unable to connect to AI service",

            error:
              err.message,
          })}\n\n`
        );

        res.end();

      }

    }

  );


  // ==========================================================================
  // Send request body
  // ==========================================================================

  proxyReq.write(
    body
  );


  proxyReq.end();


  // ==========================================================================
  // Client disconnect handling
  // ==========================================================================

  req.on(
    "close",

    () => {

      if (!proxyReq.destroyed) {

        console.log(
          "[SSE PROXY] Client disconnected"
        );

        proxyReq.destroy();

      }

      if (req.executionId) {
        aiBillingService.releaseReservation({
          executionId: req.executionId,
          reason: "Client disconnected prematurely",
        }).catch(() => {});
      }

    }

  );


};


// ============================================================================
// Streaming route
//
// Must come before the catch-all proxy.
// ============================================================================

router.post(
  /\/[^/]+\/copilot\/stream/,
  sseProxy
);

router.post(
  /\/[^/]+\/clarify/,
  sseProxy
);


// ============================================================================
// All remaining AI requests
// ============================================================================

router.use(
  "/",
  aiProxy
);


export default router;
