const ANDROID_PUBLISHER_HOST = "androidpublisher.googleapis.com";
const VOIDED_PURCHASES_SUFFIX = "/purchases/voidedpurchases";

export function sanitizeGooglePlayVoidedPurchasesUrl(input: URL): URL {
  const url = new URL(input.toString());
  if (url.hostname !== ANDROID_PUBLISHER_HOST || !url.pathname.endsWith(VOIDED_PURCHASES_SUFFIX)) {
    return url;
  }

  // Google Play defines startTime/endTime as optional and applies its own
  // canonical rolling 30-day window when they are omitted. Removing our
  // client-computed boundary avoids requests falling just outside the
  // accepted window between timestamp calculation and server validation.
  url.searchParams.delete("startTime");
  url.searchParams.delete("endTime");
  return url;
}

export function installGooglePlayVoidedPurchasesFetchGuard(): void {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== "function") return;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (input instanceof URL) {
      return originalFetch(sanitizeGooglePlayVoidedPurchasesUrl(input), init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
