import { expect, test, type Page } from "@playwright/test";

type Point = { x: number; y: number };
type OriginKind = "overlay-origin" | "cta-origin";
type GestureKind = "pan" | "tap";

interface GestureEvidence {
  origin: OriginKind;
  gesture: GestureKind;
  point: Point;
  hit: {
    tag: string;
    text: string;
    ancestry: string[];
    insideCta: boolean;
    insideConsent: boolean;
    touchAction: string;
    ctaTouchAction: string;
  };
  event: { type: string; target: string; path: string[] } | null;
  owner: {
    tag: string;
    containsCta: boolean;
    before: number;
    after: number;
    max: number;
  };
  sheetCount: number;
  selectedTab: string | null;
  analyticsCount: number;
}

async function ctaPoint(page: Page): Promise<Point> {
  const box = await page.getByTestId("issue-2729-reserve-cta").boundingBox();
  expect(box).not.toBeNull();
  return {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
}

async function setVenueScrollToLowerBoundary(page: Page): Promise<void> {
  await page.getByTestId("issue-2729-reserve-cta").evaluate((cta) => {
    let owner = cta.parentElement;
    while (owner !== null) {
      const style = getComputedStyle(owner);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        owner.scrollHeight > owner.clientHeight
      ) {
        owner.scrollTop = owner.scrollHeight - owner.clientHeight;
        return;
      }
      owner = owner.parentElement;
    }
    throw new Error("issue #2768 could not find the venue scroll owner");
  });
  await page.waitForTimeout(100);
}

async function captureTouchGesture(
  page: Page,
  origin: OriginKind,
  start: Point,
  end: Point,
  gesture: GestureKind = "pan",
): Promise<GestureEvidence> {
  const precondition = await page.evaluate(({ origin, start }) => {
    const cta = document.querySelector<HTMLElement>(
      "[data-testid='issue-2729-reserve-cta']",
    );
    const consent = document.querySelector<HTMLElement>(
      "[aria-label='Cookie consent']",
    );
    const hit = document.elementFromPoint(start.x, start.y) as HTMLElement | null;
    if (cta === null || hit === null) {
      throw new Error("issue #2768 named-origin precondition has no CTA/hit");
    }
    const ctaOwnsHit = cta === hit || cta.contains(hit);
    const consentOwnsHit =
      consent !== null && (consent === hit || consent.contains(hit));
    if (origin === "cta-origin" && !ctaOwnsHit) {
      throw new Error("issue #2768 refused to name a non-CTA hit CTA-origin");
    }
    if (origin === "overlay-origin" && !consentOwnsHit) {
      throw new Error("issue #2768 refused to name a non-consent hit overlay-origin");
    }
    let owner = cta.parentElement;
    while (owner !== null) {
      const style = getComputedStyle(owner);
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        owner.scrollHeight > owner.clientHeight
      ) {
        break;
      }
      owner = owner.parentElement;
    }
    if (owner === null) throw new Error("issue #2768 has no venue scroll owner");
    owner.dataset.issue2768ScrollOwner = "true";
    const ancestry: string[] = [];
    for (let node: HTMLElement | null = hit; node !== null; node = node.parentElement) {
      ancestry.push(
        node.getAttribute("data-testid") ??
          node.getAttribute("aria-label") ??
          node.tagName,
      );
    }
    const evidenceWindow = window as Window & {
      __issue2768LastEvent?: {
        type: string;
        target: string;
        path: string[];
      } | null;
    };
    evidenceWindow.__issue2768LastEvent = null;
    const record = (event: Event): void => {
      if (evidenceWindow.__issue2768LastEvent !== null) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      evidenceWindow.__issue2768LastEvent = {
        type: event.type,
        target:
          target?.getAttribute("data-testid") ??
          target?.getAttribute("aria-label") ??
          target?.tagName ??
          "unknown",
        path: event
          .composedPath()
          .filter((node): node is HTMLElement => node instanceof HTMLElement)
          .map(
            (node) =>
              node.getAttribute("data-testid") ??
              node.getAttribute("aria-label") ??
              node.tagName,
          ),
      };
    };
    document.addEventListener("pointerdown", record, {
      capture: true,
      once: true,
    });
    document.addEventListener("touchstart", record, {
      capture: true,
      once: true,
    });
    return {
      hit: {
        tag: hit.tagName,
        text: (hit.textContent ?? "").trim().slice(0, 100),
        ancestry,
        insideCta: ctaOwnsHit,
        insideConsent: consentOwnsHit,
        touchAction: getComputedStyle(hit).touchAction,
        ctaTouchAction: getComputedStyle(cta).touchAction,
      },
      owner: {
        tag: owner.tagName,
        containsCta: owner.contains(cta),
        before: owner.scrollTop,
        max: owner.scrollHeight - owner.clientHeight,
      },
    };
  }, { origin, start });

  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  if (gesture === "pan") {
    for (let step = 1; step <= 12; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 12,
            y: start.y + ((end.y - start.y) * step) / 12,
          },
        ],
      });
      await page.waitForTimeout(16);
    }
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    const owner = document.querySelector<HTMLElement>(
      "[data-issue2768-scroll-owner='true']",
    );
    const selected = document.querySelector<HTMLElement>(
      "[role='tab'][aria-selected='true']",
    );
    const evidenceWindow = window as Window & {
      __issue2768LastEvent?: {
        type: string;
        target: string;
        path: string[];
      } | null;
      __issue2768VenueAnalytics?: string[];
    };
    return {
      event: evidenceWindow.__issue2768LastEvent ?? null,
      after: owner?.scrollTop ?? -1,
      sheetCount: document.querySelectorAll(
        "[data-testid='issue-2768-sheet']",
      ).length,
      selectedTab: selected?.textContent?.trim() ?? null,
      analyticsCount: (evidenceWindow.__issue2768VenueAnalytics ?? []).filter(
        (event) => event === "public_venue_reservation_started",
      ).length,
    };
  });

  return {
    origin,
    gesture,
    point: start,
    hit: precondition.hit,
    event: after.event,
    owner: {
      ...precondition.owner,
      after: after.after,
    },
    sheetCount: after.sheetCount,
    selectedTab: after.selectedTab,
    analyticsCount: after.analyticsCount,
  };
}

async function assertNoAnalyticsInitialization(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => ({
      cookies: document.cookie,
      dataLayer: (window as Window & { dataLayer?: unknown[] }).dataLayer,
      gtag: typeof (window as Window & { gtag?: unknown }).gtag,
      analyticsScripts: document.querySelectorAll(
        "script[data-mingla-ga4], script[data-mingla-pixel]",
      ).length,
    })),
  ).toEqual({
    cookies: "",
    dataLayer: undefined,
    gtag: "undefined",
    analyticsScripts: 0,
  });
}

for (const topology of ["business-preview", "buyer-host"] as const) {
  test(`${topology} names the overlay honestly, rejects visibly, then proves CTA pan and tap`, async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) =>
      runtimeErrors.push(error.stack ?? error.message),
    );
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(`/${topology}`);
    await expect(page.getByTestId(`issue-2768-topology-${topology}`)).toBeVisible();
    await expect(page.getByLabel("Cookie consent")).toBeVisible();
    await expect(page.getByTestId("issue-2729-reserve-cta")).toBeVisible();
    expect(await page.evaluate(() => window.__issue2768Topology)).toBe(topology);
    await assertNoAnalyticsInitialization(page);

    await setVenueScrollToLowerBoundary(page);
    const freshPoint = await ctaPoint(page);
    const ctaRectOwnsPoint = await page
      .getByTestId("issue-2729-reserve-cta")
      .evaluate((cta, point) => {
        const rect = cta.getBoundingClientRect();
        return (
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        );
      }, freshPoint);
    expect(ctaRectOwnsPoint).toBe(true);
    expect(
      await page
        .getByTestId("issue-2729-reserve-cta")
        .evaluate((node) => getComputedStyle(node).touchAction),
    ).toBe("manipulation");

    const freshOverlay = await captureTouchGesture(
      page,
      "overlay-origin",
      freshPoint,
      { x: freshPoint.x, y: Math.min(842, freshPoint.y + 48) },
    );
    expect(freshOverlay.hit.insideConsent).toBe(true);
    expect(freshOverlay.hit.insideCta).toBe(false);
    expect(freshOverlay.owner.containsCta).toBe(true);
    expect(freshOverlay.owner.before).toBeCloseTo(freshOverlay.owner.max, 0);
    expect(freshOverlay.owner.after).toBeCloseTo(freshOverlay.owner.before, 0);
    expect(freshOverlay.sheetCount).toBe(0);
    expect(freshOverlay.selectedTab).toBe("Overview");
    expect(freshOverlay.analyticsCount).toBe(0);
    expect(freshOverlay.event?.path).toContain("Cookie consent");

    await page
      .getByRole("button", { name: "Reject cookies and analytics" })
      .click();
    await expect(page.getByLabel("Cookie consent")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mingla_consent_v1") ?? "null"),
      ),
    ).toMatchObject({ choice: "denied" });
    await assertNoAnalyticsInitialization(page);
    expect(
      await page.evaluate(
        () =>
          window.__issue2768VenueAnalytics.filter(
            (event) => event === "public_venue_reservation_started",
          ).length,
      ),
    ).toBe(0);

    await setVenueScrollToLowerBoundary(page);
    const postRejectPoint = await ctaPoint(page);
    const ctaPan = await captureTouchGesture(
      page,
      "cta-origin",
      postRejectPoint,
      { x: postRejectPoint.x, y: Math.min(842, postRejectPoint.y + 48) },
    );
    expect(ctaPan.hit.insideCta).toBe(true);
    expect(ctaPan.hit.insideConsent).toBe(false);
    expect(ctaPan.hit.ctaTouchAction).toBe("manipulation");
    expect(ctaPan.event?.path).toContain("issue-2729-reserve-cta");
    expect(ctaPan.owner.after).toBeLessThan(ctaPan.owner.before - 1);
    expect(ctaPan.sheetCount).toBe(0);
    expect(ctaPan.selectedTab).toBe("Overview");
    expect(ctaPan.analyticsCount).toBe(0);

    const tapPoint = await ctaPoint(page);
    const ctaTap = await captureTouchGesture(
      page,
      "cta-origin",
      tapPoint,
      tapPoint,
      "tap",
    );
    expect(ctaTap.hit.insideCta).toBe(true);
    expect(ctaTap.hit.insideConsent).toBe(false);
    expect(ctaTap.hit.ctaTouchAction).toBe("manipulation");
    expect(ctaTap.event?.path).toContain("issue-2729-reserve-cta");
    expect(ctaTap.owner.after).toBeGreaterThanOrEqual(0);
    expect(ctaTap.owner.after).toBeLessThanOrEqual(ctaTap.owner.max);
    expect(ctaTap.sheetCount).toBe(1);
    expect(ctaTap.selectedTab).toBe("Reservations");
    expect(ctaTap.analyticsCount).toBe(1);
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
