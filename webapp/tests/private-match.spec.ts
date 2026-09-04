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

async function mockGuest(page: Page) {
  await page.route("**/leaderboard/boards", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ boards: ["WORLD"] }) }));
  await page.route("**/leaderboard?*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ board: "WORLD", entries: [], yourPoints: 0, totalRanked: 0 }) }));
  await page.route("**/guest/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      guest: {
        guestId: "g-private-test",
        guestSecret: "private-secret",
        displayName: "PrivateGuest",
        expiresAt: Date.now() + 30 * 60 * 1000,
        stats: emptyStats,
      },
      reused: false,
    }),
  }));
  await page.route("**/guest/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      guest: {
        guestId: "g-private-test",
        displayName: "PrivateGuest",
        expiresAt: Date.now() + 30 * 60 * 1000,
        stats: emptyStats,
      },
    }),
  }));
}

test("host creates updates and enters a private room with trusted guest credentials", async ({ page }) => {
  await mockGuest(page);
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const joins: Array<Record<string, unknown>> = [];
  const secrets: string[] = [];

  await page.route("**/private-match/create", async (route) => {
    creates.push(route.request().postDataJSON() as Record<string, unknown>);
    secrets.push((await route.request().headerValue("x-guest-secret")) ?? "");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        code: "AB2CD3",
        roomId: "private-AB2CD3-quick-mixed-nonce",
        roomTicket: "host-create-ticket",
        mode: "QUICK",
        difficulty: "MIXED",
        createdAt: 1,
        updatedAt: 1,
      }),
    });
  });

  await page.route("**/private-match/update", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    updates.push(body);
    secrets.push((await route.request().headerValue("x-guest-secret")) ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: "AB2CD3",
        roomId: `private-AB2CD3-${String(body.mode).toLowerCase()}-${String(body.difficulty).toLowerCase()}-nonce`,
        roomTicket: "host-update-ticket",
        mode: body.mode,
        difficulty: body.difficulty,
        createdAt: 1,
        updatedAt: 2,
      }),
    });
  });

  await page.route("**/private-match/join", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    joins.push(body);
    secrets.push((await route.request().headerValue("x-guest-secret")) ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: "AB2CD3",
        roomId: "private-AB2CD3-tournament-hard-nonce",
        roomTicket: "fresh-join-ticket",
        mode: "TOURNAMENT",
        difficulty: "HARD",
        createdAt: 1,
        updatedAt: 3,
      }),
    });
  });

  await page.route("**/websocket-ticket", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "Intentional private test stop" }),
  }));

  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "PLAY" }).click();
  await page.getByRole("button", { name: "CREATE PRIVATE ROOM" }).click();
  await expect(page.getByText("AB2CD3")).toBeVisible();
  expect(creates).toEqual([{ mode: "QUICK", difficulty: "MIXED" }]);

  await page.getByRole("button", { name: "Select private mode tournament" }).click();
  await expect.poll(() => updates.at(-1)?.mode).toBe("TOURNAMENT");
  await page.getByRole("button", { name: "Select private difficulty hard" }).click();
  await expect.poll(() => updates.at(-1)).toMatchObject({ code: "AB2CD3", mode: "TOURNAMENT", difficulty: "HARD" });

  await page.getByRole("button", { name: "ENTER PRIVATE ARENA" }).click();
  await expect(page.getByText("Intentional private test stop")).toBeVisible({ timeout: 6_000 });
  expect(joins).toEqual([{ code: "AB2CD3" }]);
  expect(secrets.every((value) => value === "private-secret")).toBe(true);
});

test("joiner normalizes a room code and obtains a fresh assignment before socket exchange", async ({ page }) => {
  await mockGuest(page);
  const joinBodies: Array<Record<string, unknown>> = [];
  const socketBodies: Array<Record<string, unknown>> = [];

  await page.route("**/private-match/join", async (route) => {
    joinBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: "AB2CD3",
        roomId: "private-AB2CD3-practice-easy-nonce",
        roomTicket: "joiner-room-ticket",
        mode: "PRACTICE",
        difficulty: "EASY",
        createdAt: 1,
        updatedAt: 1,
      }),
    });
  });
  await page.route("**/websocket-ticket", async (route) => {
    socketBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Stop after assignment verification" }) });
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "PLAY" }).click();
  await page.getByRole("textbox", { name: "Room code" }).fill("ab2cd3");
  await page.getByRole("button", { name: "JOIN BY CODE" }).click();

  await expect(page.getByText("Stop after assignment verification")).toBeVisible({ timeout: 6_000 });
  expect(joinBodies).toEqual([{ code: "AB2CD3" }]);
  expect(socketBodies).toEqual([
    { roomId: "private-AB2CD3-practice-easy-nonce", mode: "PRACTICE", roomTicket: "joiner-room-ticket" },
    { roomId: "private-AB2CD3-practice-easy-nonce", mode: "PRACTICE", roomTicket: "joiner-room-ticket" },
    { roomId: "private-AB2CD3-practice-easy-nonce", mode: "PRACTICE", roomTicket: "joiner-room-ticket" },
  ]);
});
