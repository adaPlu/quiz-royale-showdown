import { describe, expect, it } from "vitest";
import { buildVoidedPurchasesEndpoint } from "./commerce.js";

describe("Google Play voided purchase query window", () => {
  it("lets Google Play apply its canonical rolling 30-day window", () => {
    const endpoint = buildVoidedPurchasesEndpoint(null);

    expect(endpoint.searchParams.has("startTime")).toBe(false);
    expect(endpoint.searchParams.has("endTime")).toBe(false);
    expect(endpoint.searchParams.get("type")).toBe("0");
    expect(endpoint.searchParams.get("includeQuantityBasedPartialRefund")).toBe("true");
    expect(endpoint.searchParams.get("maxResults")).toBe("1000");
  });

  it("preserves pagination tokens without changing the server-defined time window", () => {
    const endpoint = buildVoidedPurchasesEndpoint("next-page-token");

    expect(endpoint.searchParams.get("token")).toBe("next-page-token");
    expect(endpoint.searchParams.has("startTime")).toBe(false);
    expect(endpoint.searchParams.has("endTime")).toBe(false);
  });
});
