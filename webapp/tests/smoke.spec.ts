import { expect, test, type Page } from "@playwright/test";

const emptyStats = {
  wins: 2,
  losses: 1,
  matchesPlayed: 3,
  totalPoints: 1450,
  bestScore: 800,
  bestPlacement: 1,
  correctAnswers: 18,
  powerUpsUsed: 2,
  powerUpCharges: 3,
  categoryPoints: {},
  bestRank: 12,
};

async function mockCommon(page: Page) {
  await page.route("**/leaderboard/boards", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ boards: ["WORLD"] }),
  }));
  await page.route("**/leaderboard?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      board: "WORLD",
      entries: [
        { rank: 1, subjectKind: "USER", subjectId: "u-top", displayName: "TriviaAce", points: 9000, wins: 20 },
        { rank: 12, subjectKind: "USER", subjectId: "u-test", displayName: "UITester", points: 1450, wins: 2, isYou: true },
      ],
      yourRank: 12,
      yourPoints: 1450,
      totalRanked: 200,
    }),
  }));
}

test("guest sees persistent product navigation and account conversion", async ({ page }) => {
  await mockCommon(page);
  await page.route("**/guest/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      guest: {
        guestId: "g-web-test",
        guestSecret: "guest-secret",
        displayName: "Challenger42",
        expiresAt: Date.now() + 30 * 60 * 1000,
        stats: emptyStats,
      },
      reused: false,
    }),
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /QUIZ/i })).toBeVisible();
  await expect(page.getByText(/Guest session/)).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const destination of ["HOME", "PLAY", "STORE", "SEASON", "PROFILE"]) {
    await expect(nav.getByRole("button", { name: destination })).toBeVisible();
  }

  await nav.getByRole("button", { name: "STORE" }).click();
  await expect(page.getByRole("heading", { name: "Account required" })).toBeVisible();

  await nav.getByRole("button", { name: "PROFILE" }).click();
  await expect(page.getByRole("tab", { name: "REGISTER", exact: true })).toBeVisible();
});

test("registered player can open store cosmetics and social panels", async ({ page }) => {
  await mockCommon(page);
  await page.addInitScript(() => sessionStorage.setItem("quizroyale.web.token", "test-token"));

  const profile = {
    userId: "u-test",
    username: "UITester",
    email: "ui@example.com",
    role: "player",
    currencyBalances: { coins: 500, gems: 20, seasonalTickets: 3 },
    createdAt: Date.now() - 10_000,
    stats: emptyStats,
    friends: [{
      userId: "u-friend",
      username: "FriendOne",
      totalPoints: 900,
      wins: 1,
      addedAt: Date.now() - 1000,
      presence: "ONLINE",
      matchMode: null,
      lastSeenAt: Date.now(),
    }],
  };

  await page.route("**/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile }) }));
  await page.route("**/store/items", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      balances: profile.currencyBalances,
      items: [{ itemId: "item-1", itemType: "POWER_UP", displayName: "Shield Pack", description: "Extra protection.", currency: "coins", price: 100, payload: {}, owned: false }],
    }),
  }));
  await page.route("**/cosmetics", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ cosmetics: [{ cosmeticId: "c-1", cosmeticType: "BADGE", displayName: "Royal Crest", rarity: "RARE", payload: {}, owned: true, equipped: true }] }),
  }));
  await page.route("**/friends/invites", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ incoming: [], outgoing: [] }),
  }));

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" });

  await nav.getByRole("button", { name: "STORE" }).click();
  await expect(page.getByRole("heading", { name: "STORE" })).toBeVisible();
  await expect(page.getByText("Shield Pack")).toBeVisible();
  await expect(page.getByText("Royal Crest")).toBeVisible();

  await nav.getByRole("button", { name: "PROFILE" }).click();
  await expect(page.getByRole("heading", { name: "Friends" })).toBeVisible();
  await expect(page.getByText("FriendOne")).toBeVisible();
});
