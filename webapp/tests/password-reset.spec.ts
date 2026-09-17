import { expect, test } from "@playwright/test";

test("guest can request and complete a password reset from the web profile", async ({ page }) => {
  await page.route("**/guest/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      guest: {
        guestId: "g-password-reset",
        guestSecret: "guest-secret",
        displayName: "ResetTester",
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
      },
      reused: false,
    }),
  }));

  let forgotIdentifier = "";
  await page.route("**/auth/forgot-password", async (route) => {
    forgotIdentifier = (route.request().postDataJSON() as { identifier?: string }).identifier ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route("**/auth/reset-password", async (route) => {
    const body = route.request().postDataJSON() as { token?: string; password?: string };
    expect(body).toEqual({ token: "reset-code-123", password: "NewPassword123!" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: "signed-in-token",
        profile: {
          userId: "u-reset",
          username: "ResetUser",
          email: "reset@example.com",
          role: "player",
          currencyBalances: { coins: 0, gems: 0, seasonalTickets: 0 },
          createdAt: Date.now(),
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
          friends: [],
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "PROFILE" }).click();
  await page.getByRole("tab", { name: "SIGN IN", exact: true }).click();

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email or username").fill("reset@example.com");
  await page.getByRole("button", { name: "SEND RESET EMAIL" }).click();

  await expect.poll(() => forgotIdentifier).toBe("reset@example.com");
  await expect(page.getByText("If that account exists, a reset email has been sent.")).toBeVisible();
  await expect(page.getByLabel("Reset code")).toBeVisible();

  await page.getByLabel("Reset code").fill("reset-code-123");
  await page.getByLabel("New password").fill("NewPassword123!");
  await page.getByRole("button", { name: "RESET PASSWORD" }).click();

  await expect(page.getByText("ResetUser")).toBeVisible();
});
