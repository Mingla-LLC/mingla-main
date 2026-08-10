import { expect, test, type BrowserContext, type Page } from "@playwright/test";
// @ts-expect-error -- pngjs is already shipped transitively; this regression
// test uses it without widening production dependencies or the lockfile.
import { PNG } from "pngjs";

const invite = "/accept-brand-invitation?token=token%20with%2Fsymbols";

async function cleanStorage(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

async function stubExpoScripts(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/_expo/static/js/web/*.js*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "unknown";
    requests.push(name);
    await route.fulfill({
      contentType: "text/javascript",
      body:
        `window.__issue922Order=(window.__issue922Order||[]).concat(${JSON.stringify(name)});` +
        `window.__issue922Roots=(window.__issue922Roots||[]).concat(!!document.getElementById("root"));` +
        `window.__issue922Choices=(window.__issue922Choices||[]).concat(window.__minglaPrebootConsentChoice);` +
        `window.__issue922ChoiceSeen=window.__minglaPrebootConsentChoice;` +
        `if((window.__issue922Order||[]).length===3){document.getElementById("root").innerHTML='<p id="issue922-app-mounted">Expo app mounted</p>'}`,
    });
  });
  return requests;
}

test("eligible invitation is actionable after two frames with no external JavaScript", async ({ context, page }) => {
  await cleanStorage(context);
  const requests = await stubExpoScripts(page);
  await page.goto(invite, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-issue922-actionable", "true");
  await expect(page.getByRole("heading", { name: "You're invited" })).toBeVisible();
  const button = page.getByRole("button", { name: "Sign in" });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBe(52);
  expect(await button.isEnabled()).toBe(true);
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  expect(await button.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe("2px");
  const hit = await page.evaluate(({ x, y }) => {
    const node = document.elementFromPoint(x, y);
    return node?.textContent;
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(hit).toContain("Sign in");
  expect(requests).toEqual([]);
});

test("Sign in preserves the untrimmed token in the existing next-route contract", async ({ context, page }) => {
  await cleanStorage(context);
  await page.route("**/auth?**", (route) => route.fulfill({ contentType: "text/html", body: "ok" }));
  await page.goto(invite);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(
    /\/auth\?next=%2Faccept-brand-invitation%3Ftoken%3Dtoken%20with%2Fsymbols$/,
  );
});

test("five cold Samsung A72 runs stay inside the actionability budget", async ({ browser, baseURL }) => {
  const samples: number[] = [];
  for (let run = 0; run < 5; run += 1) {
    const context = await browser.newContext();
    await cleanStorage(context);
    const page = await context.newPage();
    const start = Date.now();
    await page.goto(`${baseURL}${invite}`);
    await expect(page.locator("html")).toHaveAttribute("data-issue922-actionable", "true");
    samples.push(Date.now() - start);
    await context.close();
  }
  const ordered = [...samples].sort((a, b) => a - b);
  expect(ordered[2], `samples=${samples.join(",")}`).toBeLessThanOrEqual(1200);
  expect(Math.max(...samples), `samples=${samples.join(",")}`).toBeLessThanOrEqual(1500);
});

test("static invitation and consent UI has no visible Samsung delta from the React owner", async ({ browser, baseURL }) => {
  async function capture(url: string): Promise<{ png: Buffer; box: { x: number; y: number; width: number; height: number } }> {
    const context = await browser.newContext();
    await cleanStorage(context);
    const page = await context.newPage();
    await page.goto(url);
    // React Native Web renders Text as a div; the critical shell improves the
    // semantics to h1, so text is the cross-renderer parity anchor.
    const heading = page.getByText("You're invited", { exact: true });
    await expect(heading).toBeVisible({ timeout: 90_000 });
    const card = heading.locator("..");
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const png = await page.screenshot();
    await context.close();
    return { png, box: box! };
  }
  const react = await capture(`${baseURL}/accept-brand-invitation?token=visual&issue922React=1`);
  const critical = await capture(`${baseURL}/accept-brand-invitation?token=visual`);
  expect(critical.box).toEqual(react.box);
  const a = PNG.sync.read(react.png);
  const b = PNG.sync.read(critical.png);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
      Math.abs(a.data[i + 3] - b.data[i + 3]),
    );
    if (delta > 12) changed += 1;
  }
  const visibleDelta = changed / (a.width * a.height);
  expect(visibleDelta, `visible pixel delta=${visibleDelta}`).toBeLessThanOrEqual(0.005);
});

for (const choice of ["granted", "denied"] as const) {
  test(`${choice} consent writes the canonical choice, hides the banner, then boots in order`, async ({ context, page }) => {
    await cleanStorage(context);
    const requests = await stubExpoScripts(page);
    await page.goto(invite);
    await expect(page.getByLabel("Cookie consent")).toBeVisible();
    await page.getByRole("button", { name: "Manage analytics preferences" }).click();
    await expect(page.getByText("Analytics help us improve Mingla")).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "https://usemingla.com/privacy-policy",
    );
    await page.getByRole("button", {
      name: choice === "granted" ? "Accept cookies and analytics" : "Reject cookies and analytics",
    }).click();
    await expect(page.getByLabel("Cookie consent")).toHaveCount(0);
    await expect(page.locator("#issue922-app-mounted")).toBeVisible();
    const state = await page.evaluate(() => ({
      stored: JSON.parse(window.localStorage.getItem("mingla_consent_v1") ?? "null"),
      order: (window as typeof window & { __issue922Order?: string[] }).__issue922Order,
      choice: (window as typeof window & { __issue922ChoiceSeen?: string }).__issue922ChoiceSeen,
    }));
    expect(state.stored.choice).toBe(choice);
    expect(typeof state.stored.ts).toBe("number");
    expect(state.choice).toBe(choice);
    expect(state.order).toHaveLength(3);
    expect(requests).toEqual(state.order);
  });
}

test("a readable store that rejects consent writes keeps the choice for multiple app readers", async ({ context, page }) => {
  await cleanStorage(context);
  const requests = await stubExpoScripts(page);
  await page.goto(invite);
  await page.evaluate(() => {
    Storage.prototype.setItem = function setItem(): never {
      throw new Error("quota rejected the consent write");
    };
  });
  await page.getByRole("button", { name: "Accept cookies and analytics" }).click();
  await expect(page.locator("#issue922-app-mounted")).toBeVisible();
  const state = await page.evaluate(() => ({
    stored: window.localStorage.getItem("mingla_consent_v1"),
    readers: (window as typeof window & { __issue922Choices?: string[] }).__issue922Choices,
    pageLifetimeChoice: window.__minglaPrebootConsentChoice,
  }));
  expect(state).toEqual({
    stored: null,
    readers: ["granted", "granted", "granted"],
    pageLifetimeChoice: "granted",
  });
  expect(requests).toHaveLength(3);
});

test("every ambiguous or returning-visitor case immediately boots the ordinary Expo app", async ({ browser, baseURL }) => {
  const cases: { url: string; storage?: [string, string]; blockedStorage?: boolean }[] = [
    { url: "/accept-brand-invitation" },
    { url: "/accept-brand-invitation?token=%20%20" },
    { url: "/other?token=valid" },
    { url: "/accept-brand-invitation?token=valid", storage: ["sb-project-auth-token", "session"] },
    { url: "/accept-brand-invitation?token=valid", storage: ["mingla_consent_v1", "malformed"] },
    { url: "/accept-brand-invitation?token=valid", blockedStorage: true },
  ];
  for (const scenario of cases) {
    const context = await browser.newContext();
    await context.addInitScript(({ stored, blocked }) => {
      if (blocked) {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() { throw new Error("storage blocked by test"); },
        });
        return;
      }
      window.localStorage.clear();
      if (stored) window.localStorage.setItem(stored[0], stored[1]);
    }, { stored: scenario.storage, blocked: scenario.blockedStorage === true });
    const page = await context.newPage();
    const requests = await stubExpoScripts(page);
    await page.goto(`${baseURL}${scenario.url}`);
    await expect(page.locator("#issue922-app-mounted")).toBeVisible();
    const roots = await page.evaluate(() => (window as typeof window & { __issue922Roots?: boolean[] }).__issue922Roots);
    expect(roots).toEqual([true, true, true]);
    expect(requests).toHaveLength(3);
    await context.close();
  }
});
