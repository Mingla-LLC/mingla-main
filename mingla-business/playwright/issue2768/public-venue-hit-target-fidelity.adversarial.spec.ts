import { expect, test, type Page } from "@playwright/test";

type Point = { x: number; y: number };
type Activation = "pointer" | "keyboard" | "touch";

interface GeometryEvidence {
  center: Point;
  centerHit: { insideConsent: boolean; insideCta: boolean; label: string };
  visibleCtaPoint: Point;
  visibleHit: { insideConsent: boolean; insideCta: boolean; label: string };
  hostContainsVisiblePoint: boolean;
  panelContainsVisiblePoint: boolean;
  hostPointerEvents: string;
  panelPointerEvents: string;
}

async function expectNoTracking(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => ({
      storedChoice: localStorage.getItem("mingla_consent_v1"),
      cookies: document.cookie,
      dataLayer: (window as Window & { dataLayer?: unknown[] }).dataLayer,
      gtag: typeof (window as Window & { gtag?: unknown }).gtag,
      analyticsScripts: document.querySelectorAll(
        "script[data-mingla-ga4], script[data-mingla-pixel]",
      ).length,
      localEvents: window.__issue2768VenueAnalytics,
      reservationEvents: window.__issue2768VenueAnalytics.filter(
        (event) => event === "public_venue_reservation_started",
      ).length,
    })),
  ).toEqual({
    storedChoice: null,
    cookies: "",
    dataLayer: undefined,
    gtag: "undefined",
    analyticsScripts: 0,
    localEvents: ["public_venue_overview_viewed"],
    reservationEvents: 0,
  });
}

async function collectFreshGeometry(page: Page): Promise<GeometryEvidence> {
  return page.evaluate(() => {
    const cta = document.querySelector<HTMLElement>(
      "[data-testid='issue-2729-reserve-cta']",
    );
    const consent = document.querySelector<HTMLElement>(
      "[aria-label='Cookie consent']",
    );
    const panel = consent?.firstElementChild as HTMLElement | null;
    if (cta === null || consent === null || panel === null) {
      throw new Error("issue #2768 adversarial geometry requires real CTA and consent owners");
    }
    const ctaRect = cta.getBoundingClientRect();
    const hostRect = consent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const contains = (rect: DOMRect, point: Point): boolean =>
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom;
    const owns = (owner: HTMLElement, hit: Element | null): boolean =>
      hit !== null && (owner === hit || owner.contains(hit));
    const label = (hit: Element | null): string =>
      hit instanceof HTMLElement
        ? hit.getAttribute("data-testid") ??
          hit.getAttribute("aria-label") ??
          hit.tagName
        : "none";

    const center = {
      x: ctaRect.left + ctaRect.width / 2,
      y: ctaRect.top + ctaRect.height / 2,
    };
    const centerElement = document.elementFromPoint(center.x, center.y);

    let visibleCtaPoint: Point | null = null;
    for (
      let y = Math.ceil(ctaRect.top + 1);
      y < Math.floor(ctaRect.bottom - 1) && visibleCtaPoint === null;
      y += 1
    ) {
      for (
        let x = Math.ceil(ctaRect.left + 1);
        x < Math.floor(ctaRect.right - 1);
        x += 1
      ) {
        const hit = document.elementFromPoint(x, y);
        if (owns(cta, hit)) {
          visibleCtaPoint = { x, y };
          break;
        }
      }
    }
    if (visibleCtaPoint === null) {
      throw new Error("issue #2768 found no genuinely hit-testable CTA pixel");
    }
    const visibleElement = document.elementFromPoint(
      visibleCtaPoint.x,
      visibleCtaPoint.y,
    );
    return {
      center,
      centerHit: {
        insideConsent: owns(consent, centerElement),
        insideCta: owns(cta, centerElement),
        label: label(centerElement),
      },
      visibleCtaPoint,
      visibleHit: {
        insideConsent: owns(consent, visibleElement),
        insideCta: owns(cta, visibleElement),
        label: label(visibleElement),
      },
      hostContainsVisiblePoint: contains(hostRect, visibleCtaPoint),
      panelContainsVisiblePoint: contains(panelRect, visibleCtaPoint),
      hostPointerEvents: getComputedStyle(consent).pointerEvents,
      panelPointerEvents: getComputedStyle(panel).pointerEvents,
    };
  });
}

async function scrollOwnerTo(page: Page, boundary: "top" | "bottom"): Promise<number> {
  return page.getByTestId("issue-2729-reserve-cta").evaluate((cta, edge) => {
    let owner = cta.parentElement;
    while (owner !== null) {
      const style = getComputedStyle(owner);
      if (/(auto|scroll)/.test(style.overflowY) && owner.scrollHeight > owner.clientHeight) {
        owner.dataset.issue2768AdversarialOwner = "true";
        owner.scrollTop = edge === "bottom" ? owner.scrollHeight - owner.clientHeight : 0;
        return owner.scrollTop;
      }
      owner = owner.parentElement;
    }
    throw new Error("issue #2768 adversarial proof found no venue scroll owner");
  }, boundary);
}

async function dispatchTouch(
  page: Page,
  start: Point,
  end: Point = start,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [start],
  });
  if (end.x !== start.x || end.y !== start.y) {
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
}

async function verifiedCtaPoint(page: Page): Promise<Point> {
  return page.getByTestId("issue-2729-reserve-cta").evaluate((cta) => {
    const rect = cta.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(point.x, point.y);
    if (hit === null || (cta !== hit && !cta.contains(hit))) {
      throw new Error("issue #2768 refused a CTA point without immediate CTA ownership");
    }
    return point;
  });
}

async function assertOneActivation(page: Page, activation: Activation): Promise<void> {
  await page.reload();
  await expect(page.getByLabel("Cookie consent")).toHaveCount(0);
  const cta = page.getByTestId("issue-2729-reserve-cta");
  await expect(cta).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.__issue2768VenueAnalytics.filter(
          (event) => event === "public_venue_reservation_started",
        ).length,
    ),
  ).toBe(0);

  if (activation === "pointer") {
    await cta.click();
  } else if (activation === "keyboard") {
    await cta.focus();
    await cta.press("Enter");
  } else {
    const point = await verifiedCtaPoint(page);
    await dispatchTouch(page, point);
  }

  await expect(page.getByTestId("issue-2768-sheet")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Reservations" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    await page.evaluate(
      () =>
        window.__issue2768VenueAnalytics.filter(
          (event) => event === "public_venue_reservation_started",
        ).length,
    ),
  ).toBe(1);
}

for (const topology of ["business-preview", "buyer-host"] as const) {
  for (const width of [320, 402] as const) {
    test(`${topology} at ${width}px proves covered, visible, and activated origins without duplication`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/health");
      await page.evaluate(() => localStorage.clear());
      await page.goto(`/${topology}?width=${width}`);
      await expect(page.getByTestId(`issue-2768-topology-${topology}`)).toBeVisible();
      await expect(page.getByLabel("Cookie consent")).toBeVisible();
      await expect(page.getByTestId("issue-2729-reserve-cta")).toBeVisible();
      await expectNoTracking(page);

      const fresh = await collectFreshGeometry(page);
      expect(fresh.centerHit.insideConsent).toBe(true);
      expect(fresh.centerHit.insideCta).toBe(false);
      expect(fresh.visibleHit.insideConsent).toBe(false);
      expect(fresh.visibleHit.insideCta).toBe(true);
      expect(fresh.hostContainsVisiblePoint).toBe(true);
      // The rounded panel rectangle still geometrically contains this corner
      // pixel. Immediate hit ownership, not rectangle membership, proves the
      // box-none host lets the genuinely visible CTA pixel receive input.
      expect(fresh.panelContainsVisiblePoint).toBe(true);
      expect(fresh.hostPointerEvents).toBe("none");
      expect(fresh.panelPointerEvents).toBe("auto");

      await page.getByRole("button", { name: "Reject cookies and analytics" }).click();
      await expect(page.getByLabel("Cookie consent")).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("mingla_consent_v1") ?? "null"),
        ),
      ).toMatchObject({ choice: "denied" });
      expect(
        await page.evaluate(() => ({
          cookies: document.cookie,
          dataLayer: (window as Window & { dataLayer?: unknown[] }).dataLayer,
          gtag: typeof (window as Window & { gtag?: unknown }).gtag,
          analyticsScripts: document.querySelectorAll(
            "script[data-mingla-ga4], script[data-mingla-pixel]",
          ).length,
          localEvents: window.__issue2768VenueAnalytics,
          reservationEvents: window.__issue2768VenueAnalytics.filter(
            (event) => event === "public_venue_reservation_started",
          ).length,
        })),
      ).toEqual({
        cookies: "",
        dataLayer: undefined,
        gtag: "undefined",
        analyticsScripts: 0,
        localEvents: ["public_venue_overview_viewed"],
        reservationEvents: 0,
      });

      const before = await scrollOwnerTo(page, "bottom");
      const postRejectPoint = await verifiedCtaPoint(page);
      const postRejectHit = await page.evaluate((point) => {
        const cta = document.querySelector<HTMLElement>(
          "[data-testid='issue-2729-reserve-cta']",
        );
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          ctaOwns: cta !== null && hit !== null && (cta === hit || cta.contains(hit)),
          pathLabel:
            hit instanceof HTMLElement
              ? hit.getAttribute("data-testid") ?? hit.tagName
              : "none",
        };
      }, postRejectPoint);
      expect(postRejectHit.ctaOwns).toBe(true);
      await dispatchTouch(page, postRejectPoint, {
        x: postRejectPoint.x,
        y: Math.min(842, postRejectPoint.y + 44),
      });
      const panState = await page.evaluate(() => ({
        after:
          document.querySelector<HTMLElement>(
            "[data-issue2768-adversarial-owner='true']",
          )?.scrollTop ?? -1,
        sheetCount: document.querySelectorAll("[data-testid='issue-2768-sheet']")
          .length,
        selected:
          document.querySelector<HTMLElement>("[role='tab'][aria-selected='true']")
            ?.textContent ?? null,
        reservationEvents: window.__issue2768VenueAnalytics.filter(
          (event) => event === "public_venue_reservation_started",
        ).length,
      }));
      expect(panState.after).toBeLessThan(before - 1);
      expect(panState.sheetCount).toBe(0);
      expect(panState.selected).toContain("Overview");
      expect(panState.reservationEvents).toBe(0);

      await assertOneActivation(page, "pointer");
      await assertOneActivation(page, "keyboard");
      await assertOneActivation(page, "touch");
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  }
}
