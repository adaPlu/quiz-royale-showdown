import { expect, test, type Page } from "@playwright/test";

const guest = {
  guestId: "g-password-reset",
  guestSecret: "guest-secret",
  displayName: "ResetGuest",
  expiresAt: Date.now() + 30 * 60 * 1000,
  stats: {
    wins: 0,
    losses: 0,
    matchesPlayed: 0,
    totalPoints: 0,
    bestScore: 0,
    bestPlacement: null,
    correctAnswers: 0,
    powerUpsUsed: 0,
    powerUpCharges: 0,
    categoryPoints: {},
    bestRank: null,
  },
};

const profile = {
  userId: "u-reset",
  username: "ResetPlayer",
  email: "reset@example.com",
  role: "player",
  currencyBalances: { coins: 0, gems: 0, seasonalTickets: 0 },
  createdAt: Date.now() - 10_000,
  stats: guest.stats,
  friends: [],
};

async function mockGuest(page: Page) {
  await page.route("**/guest/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ guest, reused: false }),
  }));
}

async function openSignIn(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "PROFILE" }).click();
  await page.getByRole("tab", { name: "SIGN IN", exact: true }).click();
}

test("sign in exposes forgot password and requests a reset without revealing account existence", async ({ page }) => {
  await mockGuest(page);
  let submittedIdentifier = "";
  await page.route("**/auth/forgot-password", async (route) => {
    const body = route.request().postDataJSON() as { identifier?: string };
    submittedIdentifier = body.identifier ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await openSignIn(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email or username").fill("ResetPlayer");
  await page.getByRole("button", { name: "SEND RESET EMAIL" }).click();

  await expect.poll(() => submittedIdentifier).toBe("ResetPlayer");
  await expect(page.getByText(/If an account matches/i)).toBeVisible();
  await expect(page.getByLabel("Reset code")).toBeVisible();
});

test("resetting a password signs the player in immediately", async ({ page }) => {
  await mockGuest(page);
  await page.route("**/auth/reset-password", async (route) => {
    const body = route.request().postDataJSON() as { token?: string; password?: string };
    expect(body).toEqual({ token: "reset-code-123", password: "NewPassword123!" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: "session-token", expiresAt: Date.now() + 3_600_000, profile, transferredFromGuest: false }),
    });
  });

  await openSignIn(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByRole("button", { name: "I HAVE A RESET CODE" }).click();
  await page.getByLabel("Reset code").fill("reset-code-123");
  await page.getByLabel("New password").fill("NewPassword123!");
  await page.getByRole("button", { name: "RESET PASSWORD" }).click();

  await expect(page.getByText("ResetPlayer")).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("quizroyale.web.token"))).toBe("session-token");
});

test("web reset links prefill the reset code", async ({ page }) => {
  await mockGuest(page);
  await page.goto("/?token=linked-reset-code");

  await expect(page.getByLabel("Reset code")).toHaveValue("linked-reset-code");
  await expect(page.getByLabel("New password")).toBeVisible();
});
