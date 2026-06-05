import { test, expect, type CDPSession } from "@playwright/test";
import { appendFileSync } from "node:fs";

// ORCH-1083 metric M-2 — mobile-profile load time of /auth/login.
// iPhone-class viewport/UA (from the config project) + 4x CPU throttle + Fast-3G
// network throttle via CDP. Measures the time from navigation start to the first
// child appearing under #root (first React paint). Runs >=3 iterations and reports
// the median. The label (before/after) comes from env ORCH_1083_LABEL.

const ITERATIONS = Number(process.env.ORCH_1083_ITERS ?? 5);
const LABEL = process.env.ORCH_1083_LABEL ?? "unlabeled";
const OUT = process.env.ORCH_1083_OUT ?? "";

async function applyThrottle(client: CDPSession): Promise<void> {
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (1.6 * 1e6) / 8, // ~1.6 Mbps Fast-3G-ish
    uploadThroughput: (0.75 * 1e6) / 8,
    latency: 150,
  });
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

test("M-2 mobile-profile time-to-first-#root-child for /auth/login", async ({ page, baseURL }) => {
  const samples: number[] = [];
  const navSamples: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const client = await page.context().newCDPSession(page);
    await client.send("Network.enable");
    // Clear cache so each run is a cold first-paint (no warm chunk cache between runs).
    await client.send("Network.clearBrowserCache");
    await applyThrottle(client);

    const start = Date.now();
    await page.goto(`${baseURL}/auth/login`, { waitUntil: "commit" });
    await page.waitForSelector("#root > *", { state: "attached", timeout: 160_000 });
    const elapsed = Date.now() - start;
    samples.push(elapsed);

    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : { dcl: 0, load: 0 };
    });
    navSamples.push(nav.dcl);

    await client.detach();
    await page.goto("about:blank");
  }

  const med = median(samples);
  const navMed = median(navSamples);
  const line =
    `ORCH-1083 M-2 [${LABEL}] iters=${ITERATIONS} ` +
    `firstRootChild_ms samples=[${samples.join(",")}] median=${med} ` +
    `DCL_ms median=${navMed.toFixed(0)}`;
  // eslint-disable-next-line no-console
  console.log(line);
  if (OUT) appendFileSync(OUT, line + "\n");

  // Sanity: a real paint happened within the timeout.
  expect(med).toBeGreaterThan(0);
});
