import http from "node:http";
import { closeCache } from "./cache.js";
import {
  handleCommerceRequest,
  startGooglePlayPendingRefundReviewAlerting,
  startGooglePlayVoidedPurchaseReconciler,
} from "./commerce.js";
import { pool } from "./db.js";
import { startSeasonLifecycleReconciler } from "./season-lifecycle.js";
import { handleRequest } from "./server.js";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);

export const appServer = http.createServer(async (request, response) => {
  if (await handleCommerceRequest(request, response)) return;
  await handleRequest(request, response);
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
