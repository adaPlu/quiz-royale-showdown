import http from "node:http";
import { closeCache } from "./cache.js";
import {
  handleCommerceRequest,
  startGooglePlayPendingRefundReviewAlerting,
  startGooglePlayVoidedPurchaseReconciler,
} from "./commerce.js";
import { pool } from "./db.js";
import { handleDifficultyQuestionRequest } from "./difficulty-questions.js";
import { recordOperationalFailure, type OperationalFailureCategory } from "./ops-alerts.js";
import { startSeasonLifecycleReconciler } from "./season-lifecycle.js";
import { handleRequest } from "./server.js";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);

function failureCategory(pathname: string): OperationalFailureCategory {
  if (pathname === "/health") return "database";
  if (pathname.includes("google-play") || pathname.includes("billing") || pathname.startsWith("/store/")) return "commerce";
  if (pathname.includes("match") || pathname.includes("questions/select")) return "matchmaking";
  return "api";
}

export const appServer = http.createServer(async (request, response) => {
  let pathname = "/";
  try {
    pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  } catch {
    pathname = "/";
  }

  response.once("finish", () => {
    if (response.statusCode < 500) return;
    const category = failureCategory(pathname);
    void recordOperationalFailure(
      category,
      `${request.method ?? "UNKNOWN"} ${pathname} -> ${response.statusCode}`,
    );
  });

  try {
    if (await handleCommerceRequest(request, response)) return;
    if (await handleDifficultyQuestionRequest(request, response)) return;
    await handleRequest(request, response);
  } catch (error) {
    console.error("top-level request failed", request.method, pathname, (error as Error)?.message);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "internal_error", message: "Something went wrong." }));
    } else if (!response.writableEnded) {
      response.end();
    }
  }
});

const stopVoidedPurchaseReconciler = startGooglePlayVoidedPurchaseReconciler();
const stopPendingRefundReviewAlerting = startGooglePlayPendingRefundReviewAlerting();
const stopSeasonLifecycleReconciler = startSeasonLifecycleReconciler();

appServer.listen(PORT, () => {
  console.log(`quiz-royale-api listening on ${PORT}`);
});

process.on("SIGTERM", () => {
  stopVoidedPurchaseReconciler();
  stopPendingRefundReviewAlerting();
  stopSeasonLifecycleReconciler();
  appServer.close(() => {
    Promise.all([pool.end(), closeCache()]).finally(() => process.exit(0));
  });
});
