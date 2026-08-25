const TELEMETRY_URL = (import.meta.env.VITE_TELEMETRY_URL as string | undefined)?.trim() || null;

type TelemetryFields = Record<string, string | number | boolean | null | undefined>;

export function trackClientEvent(name: string, fields: TelemetryFields = {}): void {
  const event = {
    name,
    at: Date.now(),
    path: window.location.pathname,
    online: navigator.onLine,
    userAgent: navigator.userAgent,
    fields,
  };

  if (import.meta.env.DEV) console.info("[telemetry]", event);
  if (!TELEMETRY_URL) return;

  const payload = JSON.stringify(event);
  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(TELEMETRY_URL, blob)) return;
  }

  void fetch(TELEMETRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

export function installClientTelemetry(): () => void {
  const onError = (event: ErrorEvent) => trackClientEvent("window_error", {
    message: event.message,
    source: event.filename || null,
    line: event.lineno || null,
    column: event.colno || null,
  });

  const onUnhandled = (event: PromiseRejectionEvent) => trackClientEvent("unhandled_rejection", {
    reason: event.reason instanceof Error ? event.reason.message : String(event.reason ?? "unknown"),
  });

  const onOffline = () => trackClientEvent("browser_offline");
  const onOnline = () => trackClientEvent("browser_online");

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandled);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  trackClientEvent("web_app_boot");

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandled);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}
