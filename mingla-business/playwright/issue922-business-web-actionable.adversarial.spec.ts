import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const target = "/accept-brand-invitation?token=independent-token";

type ProbeWindow = Window & {
  __adversarialOrder?: string[];
  __adversarialRoots?: boolean[];
  __adversarialChoices?: (string | undefined)[];
  __minglaPrebootConsentChoice?: "granted" | "denied";
  __hostileExecuted?: boolean;
};

async function clean(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

async function captureFullApp(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route("**/_expo/static/js/web/*.js*", async (route) => {
    const filename = new URL(route.request().url()).pathname.split("/").at(-1) ?? "unknown";
    requests.push(filename);
    await route.fulfill({
      contentType: "text/javascript",
      body:
        `window.__adversarialOrder=(window.__adversarialOrder||[]).concat(${JSON.stringify(filename)});` +
        `window.__adversarialRoots=(window.__adversarialRoots||[]).concat(Boolean(document.getElementById("root")));` +
        `window.__adversarialChoices=(window.__adversarialChoices||[]).concat(window.__minglaPrebootConsentChoice);` +
        `if(window.__adversarialOrder.length===3){document.getElementById("root").replaceChildren(Object.assign(document.createElement("p"),{id:"adversarial-full-app",textContent:"Full Expo app mounted"}))}`,
    });
  });
  return requests;
}

async function expectFullApp(page: Page, requests: string[], label = "full app fallback", timeout = 30_000): Promise<void> {
  await expect(page.locator("#adversarial-full-app"), label).toBeVisible({ timeout });
  const state = await page.evaluate(() => ({
    order: (window as ProbeWindow).__adversarialOrder,
    roots: (window as ProbeWindow).__adversarialRoots,
  }));
  expect(state.order).toHaveLength(3);
  expect(requests).toEqual(state.order);
  expect(state.roots).toEqual([true, true, true]);
}

test("eligible first visit exposes one accessible hit target and no external JS or analytics", async ({ context, page }) => {
  await clean(context);
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script" || /posthog|mixpanel|google-analytics|googletagmanager/i.test(request.url())) {
      external.push(request.url());
    }
  });
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-issue922-actionable", "true");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toHaveCount(1);
  const rect = await signIn.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.height).toBeGreaterThanOrEqual(44);
  expect(await signIn.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === node;
  })).toBe(true);
  await signIn.focus();
  await expect(signIn).toBeFocused();
  await expect(page.getByLabel("Cookie consent")).toBeVisible();
  expect(external).toEqual([]);
});

test("hostile token stays inert, absent from markup/logs, and encoded in the auth resume URL", async ({ context, page }) => {
  await clean(context);
  const hostile = `\"><img src=x onerror=window.__hostileExecuted=true><script>window.__hostileExecuted=true</script>`;
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.route("**/auth?**", (route) => route.fulfill({ contentType: "text/html", body: "auth" }));
  await page.goto(`/accept-brand-invitation?token=${encodeURIComponent(hostile)}`);
  const body = await page.locator("body").innerHTML();
  expect(body).not.toContain(hostile);
  expect(logs.join("\n")).not.toContain(hostile);
  expect(await page.evaluate(() => (window as ProbeWindow).__hostileExecuted)).not.toBe(true);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const expected = `/auth?next=${encodeURIComponent(`/accept-brand-invitation?token=${hostile}`)}`;
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(expected);
});

test("stored auth, consent, token, path, and storage ambiguities always mount the full app", async ({ browser, baseURL }) => {
  const cases: {
    label: string;
    path: string;
    setup?: "auth" | "auth-stale" | "consent-valid" | "consent-malformed" | "getter" | "iterate";
  }[] = [
    { label: "missing token", path: "/accept-brand-invitation" },
    { label: "blank token", path: "/accept-brand-invitation?token=%20%09" },
    { label: "stored auth", path: target, setup: "auth" },
    { label: "stale auth", path: target, setup: "auth-stale" },
    { label: "valid consent", path: target, setup: "consent-valid" },
    { label: "malformed consent", path: target, setup: "consent-malformed" },
    { label: "storage getter failure", path: target, setup: "getter" },
    { label: "storage iteration failure", path: target, setup: "iterate" },
  ];
  for (const scenario of cases) {
    const context = await browser.newContext();
    await context.addInitScript((setup) => {
      if (setup === "getter") {
        Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked getter"); } });
        return;
      }
      window.localStorage.clear();
      if (setup === "iterate") {
        window.localStorage.setItem("unrelated-key", "value");
        Storage.prototype.key = function key(): never { throw new Error("blocked iteration"); };
      }
      if (setup === "auth") window.localStorage.setItem("sb-project-auth-token", JSON.stringify({ access_token: "x" }));
      if (setup === "auth-stale") window.localStorage.setItem("sb-old-project-auth-token", "expired");
      if (setup === "consent-valid") window.localStorage.setItem("mingla_consent_v1", JSON.stringify({ choice: "denied", ts: 1 }));
      if (setup === "consent-malformed") window.localStorage.setItem("mingla_consent_v1", "not-json");
    }, scenario.setup);
    const page = await context.newPage();
    const requests = await captureFullApp(page);
    await page.goto(`${baseURL}${scenario.path}`);
    await expectFullApp(page, requests, scenario.label);
    await context.close();
  }
});

test("exact invite and trailing slash are critical; success, scanner, callback, public, checkout, root, and lookalikes stay SPA", async ({ browser, baseURL }) => {
  for (const path of [target, "/accept-brand-invitation/?token=independent-token"]) {
    const context = await browser.newContext();
    await clean(context);
    const page = await context.newPage();
    const requests = await captureFullApp(page);
    await page.goto(`${baseURL}${path}`);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    await context.close();
  }
  for (const path of [
    "/accept-brand-invitation/success?token=x",
    "/accept-brand-invitation-scanner?token=x",
    "/auth/callback?token=x",
    "/e/brand/event?token=x",
    "/checkout/event-id?token=x",
    "/?token=x",
    "/accept-brand-invitation-evil?token=x",
  ]) {
    const context = await browser.newContext();
    await clean(context);
    const page = await context.newPage();
    const requests = await captureFullApp(page);
    await page.goto(`${baseURL}${path}`);
    await expectFullApp(page, requests);
    await context.close();
  }
});

test("consent write failure preserves denied choice for every same-page reader", async ({ context, page }) => {
  await clean(context);
  const requests = await captureFullApp(page);
  await page.goto(target);
  await page.evaluate(() => {
    Storage.prototype.setItem = function setItem(): never { throw new Error("quota"); };
  });
  await page.getByRole("button", { name: "Reject cookies and analytics" }).click();
  await expectFullApp(page, requests);
  const result = await page.evaluate(() => ({
    stored: window.localStorage.getItem("mingla_consent_v1"),
    choices: (window as ProbeWindow).__adversarialChoices,
    handoff: (window as ProbeWindow).__minglaPrebootConsentChoice,
  }));
  expect(result).toEqual({ stored: null, choices: ["denied", "denied", "denied"], handoff: "denied" });
});

test("a late bootstrap exception falls back to the full app instead of stranding static markup", async ({ context, page }) => {
  await clean(context);
  await context.addInitScript(() => {
    window.requestAnimationFrame = function requestAnimationFrame(): never {
      throw new Error("adversarial bootstrap failure");
    };
  });
  const requests = await captureFullApp(page);
  await page.goto(target);
  await expectFullApp(page, requests, "late bootstrap exception must replay Expo", 5_000);
});
