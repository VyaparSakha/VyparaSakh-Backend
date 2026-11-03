import { Router } from "express";
import dotenv from "dotenv";
dotenv.config();
import { createProxyMiddleware } from "http-proxy-middleware";
import mongoose from "mongoose";

import authMiddleware from "../../middlewares/auth.middleware.js";
import requireUser from "../../middlewares/requireUser.middleware.js";
import { Store, Employee, User } from "../../models/index.js";
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

    // Check account-level AI credit quota on the Store Owner's account
    const billableOwner = authContext.isOwner
      ? req.user
      : await User.findById(store.owner);

    if (billableOwner && typeof billableOwner.hasAiCredits === "function" && !billableOwner.hasAiCredits()) {
      const quotaMessage = authContext.isOwner
        ? "Your account AI monthly query quota has been reached. Please upgrade your plan in Account Settings."
        : "Store owner's account AI subscription quota reached. Please notify your store owner to upgrade or renew their account plan.";
      return res.status(402).json({
        success: false,
        message: quotaMessage,
        statusCode: 402,
      });
    }

    // Increment AI credit usage for the store owner's account asynchronously
    if (billableOwner && typeof billableOwner.consumeAiCredit === "function") {
      billableOwner.consumeAiCredit(1).catch((err) => {
        console.error("[AI QUOTA] Failed to consume AI credit for owner account:", billableOwner._id, err.message);
      });
    }

    req.store = store;
    req.authContext = authContext;
    req.aiHeaders = {
      "x-store-id": authContext.storeId,
      "x-user-id": authContext.userId,
      "x-is-owner": authContext.isOwner ? "true" : "false",
      "x-user-role": authContext.roleName,
      "x-user-permissions": authContext.permissions.join(","),
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

  const body = JSON.stringify(
    req.body || {}
  );


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
    headers["x-store-id"] = req.aiHeaders["x-store-id"];
    headers["x-is-owner"] = req.aiHeaders["x-is-owner"];
    headers["x-user-role"] = req.aiHeaders["x-user-role"];
    headers["x-user-permissions"] = req.aiHeaders["x-user-permissions"];
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
      // Forward FastAPI stream directly
      // ----------------------------------------------------------------------

      proxyRes.pipe(res);


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
