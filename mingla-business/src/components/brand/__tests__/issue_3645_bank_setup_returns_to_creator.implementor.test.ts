/**
 * issue #3645 — after bank setup the host lands back on the creator screen
 * they left, on all four creators, web and native.
 *
 * Before this change nothing carried the origin: the web flow always returned
 * to `/brand/{id}/payments`, and only `?from=brand-create` existed.
 *
 * The validation and URL building are executed in
 * `utils/__tests__/issue_3645_bank_setup_return.implementor.test.ts`. This file
 * pins the WIRING: every bank-setup surface reads the one validated param and
 * honours it, the brand-creation funnel is untouched, every creator sends its
 * own kind and step, and leaving bank setup refreshes the brand's payment
 * state. Source assertions, per the repo's node-jest convention for RN
 * components (see StripeBlockedCard.test.tsx).
 */

import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relative: string): string =>
  readFileSync(path.join(process.cwd(), relative), "utf8");

const NATIVE_ALIAS = read("app/brand/[id]/connect.tsx");
const ONBOARD_ROUTE = read("app/brand/[id]/payments/onboard.tsx");
const WEB_BODY = read("src/components/brand/BrandBankConnectBody.web.tsx");
const ONBOARD_VIEW = read("src/components/brand/BrandOnboardView.tsx");

describe("#3645 — every bank-setup surface reads the ONE validated param", () => {
  test("none of them navigates to a raw route param", () => {
    for (const source of [NATIVE_ALIAS, ONBOARD_ROUTE, WEB_BODY]) {
      expect(source).toContain("sanitizeBankSetupReturnPath(params.resume)");
      // The param is only ever used through the sanitised value.
      const uses = source.split("params.resume").length - 1;
      expect(uses).toBe(1);
    }
  });

  test("native alias carries the validated path on to the onboarding route", () => {
    expect(NATIVE_ALIAS).toContain("withBankSetupReturn(");
    expect(NATIVE_ALIAS).toContain("resumePath,");
  });

  test("onboarding route: back to the creator when there is history, reopen it when there is none", () => {
    const start = ONBOARD_ROUTE.indexOf("const handleBack = (): void => {");
    expect(start).toBeGreaterThan(-1);
    const body = ONBOARD_ROUTE.slice(start, start + 1100);
    const funnel = body.indexOf("isBrandCreateFunnel && brandId !== null");
    const back = body.indexOf("router.back()");
    const resume = body.indexOf("router.replace(resumePath as never)");
    const payments = body.indexOf("router.replace(`/brand/${brand.id}/payments`");
    expect(funnel).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(funnel);
    expect(resume).toBeGreaterThan(back);
    expect(payments).toBeGreaterThan(resume);
    // "Done" and "Cancel" share that one decision.
    expect(ONBOARD_ROUTE).toContain("onCancel={handleBack}");
    expect(ONBOARD_ROUTE).toContain("onAfterDone={handleAfterDone}");
  });

  test("onboarding route hands the path to the view for hosted setup's return URL", () => {
    expect(ONBOARD_ROUTE).toContain(
      "returnPath={isBrandCreateFunnel ? null : resumePath}",
    );
    // Hosted setup returns to the creator on the web, finished or not; with no
    // usable path it is the payments page exactly as before.
    expect(ONBOARD_VIEW).toContain(
      "buildBankSetupWebReturnUrl(window.location.origin, returnPath) ??",
    );
    expect(ONBOARD_VIEW).toContain(
      "buildLegacyWebReturnUrl(window.location.origin, brand.id)",
    );
    // Native keeps its deep link: the creator is still mounted underneath.
    expect(ONBOARD_VIEW).toContain(": RETURN_DEEP_LINK;");
  });

  test("web connect body: back, bank connected, and hosted setup all return to the creator", () => {
    expect(WEB_BODY.split("router.replace(resumePath as never)").length - 1).toBe(2);
    expect(WEB_BODY).toContain("returnPath: resumePath,");
  });
});

describe("#3645 — the brand-creation funnel keeps its own return", () => {
  test("web body ignores the creator path inside the funnel", () => {
    expect(WEB_BODY).toContain("const resumePath = isBrandCreateFunnel\n    ? null");
    expect(WEB_BODY).toContain(
      'destination: isBrandCreateFunnel ? "brand-create" : "payments"',
    );
  });

  test("the funnel branch still wins in both back handlers", () => {
    for (const source of [ONBOARD_ROUTE, WEB_BODY]) {
      expect(source).toContain(
        "`/brand/new?resume_brand=${encodeURIComponent(brandId)}`",
      );
    }
    expect(NATIVE_ALIAS).toContain(
      "`/brand/${encodeURIComponent(brandId)}/payments/onboard?from=brand-create${countryQuery}`",
    );
  });
});

describe("#3645 — each creator sends its own kind and the step the host is on", () => {
  test("event route", () => {
    const src = read("app/event/[id]/edit.tsx");
    expect(src).toContain("brandPaymentOnboardingRoute(draft.brandId)");
    expect(src).toContain('kind: "event"');
    expect(src).toContain("step: draft.lastStepReached ?? initialStep ?? null");
  });

  test("RSVP route", () => {
    const src = read("app/rsvp/[id]/edit.tsx");
    expect(src).toContain('kind: "rsvp"');
    expect(src).toContain(
      "step: step ?? draft.lastStepReached ?? initialStep ?? null",
    );
    expect(src).not.toContain(
      "router.push(`/brand/${draft.brandId}/payments/onboard` as never)",
    );
  });

  test("trip wizard and its route's ?step=", () => {
    const wizard = read("src/components/trip/TripCreatorWizard.tsx");
    expect(wizard).toContain(
      'buildBankSetupReturnPath({ kind: "trip", id: trip.id, step })',
    );
    expect(wizard).toContain("router.push(bankSetupRoute as never)");
    expect(wizard).toContain("resolveTripWizardInitialStep(initialStep)");
    const route = read("app/trip/[id]/edit.tsx");
    expect(route).toContain("initialStep={initialStep}");
    expect(route).toContain("/^[0-9]{1,2}$/.test(stepParam)");
  });

  test("experience wizard and its route's ?step=", () => {
    const wizard = read("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(wizard).toContain('kind: "experience"');
    expect(wizard).toContain("resolveExperienceWizardInitialStep(initialStep)");
    const route = read("app/experience/[id]/edit.tsx");
    expect(route).toContain("initialStep={isLive ? undefined : initialStep}");
  });
});

describe("#3645 — the experience draft is saved before the host leaves", () => {
  const wizard = read("src/components/experience/ExperienceCreatorWizard.tsx");
  const start = wizard.indexOf("const handleConnectStripe = useCallback((): void => {");
  const body = wizard.slice(start, start + 2600);

  test("a draft save (never a publish) runs before the navigation", () => {
    expect(start).toBeGreaterThan(-1);
    const save = body.indexOf('"issue_1719_publish_experience_with_poster"');
    const push = body.lastIndexOf("router.push(");
    expect(save).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(save);
    expect(body).toContain("p_payload: buildPayload(false)");
    expect(body).toContain("p_publish: false");
    expect(body).not.toContain("p_publish: true");
  });

  test("a failed save keeps the host on the screen with a reason", () => {
    const failed = body.indexOf("if (error !== null) {");
    expect(failed).toBeGreaterThan(-1);
    const after = body.slice(failed, failed + 160);
    expect(after).toContain("setToast(EXPERIENCE_SAVE_BEFORE_BANK_FAILED_COPY)");
    expect(after).toContain("return;");
  });

  test("a live experience is never written by this path", () => {
    const live = body.indexOf("if (isLiveEdit) {");
    const save = body.indexOf('"issue_1719_publish_experience_with_poster"');
    expect(live).toBeGreaterThan(-1);
    expect(live).toBeLessThan(save);
    expect(body.slice(live, save)).toContain("return;");
  });
});

describe("#3645 — leaving bank setup refreshes the brand's payment state", () => {
  test("both bank-setup views refresh as they unmount", () => {
    expect(ONBOARD_VIEW).toContain(
      "refreshBrandPaymentState(queryClient, brandIdForRefresh);",
    );
    expect(WEB_BODY).toContain(
      "refreshBrandPaymentState(bodyQueryClient, brandId);",
    );
  });

  test("the helper invalidates the brand, the brand list and both rail statuses, and never throws", () => {
    jest.isolateModules(() => {
      jest.doMock("../../../hooks/useBrandPaystack", () => ({
        brandPaystackKeys: {
          status: (id: string) => ["brand-paystack", "status", id],
        },
      }));
      jest.doMock("../../../hooks/useBrandStripeStatus", () => ({
        brandStripeStatusKeys: {
          detail: (id: string) => ["brand-stripe-status", id],
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../../../hooks/brandPaymentStateRefresh") as typeof import("../../../hooks/brandPaymentStateRefresh");
      const invalidated: unknown[] = [];
      mod.refreshBrandPaymentState(
        {
          invalidateQueries: ((filters: { queryKey: unknown }) => {
            invalidated.push(filters.queryKey);
            return Promise.resolve();
          }) as never,
        },
        "brand-1",
      );
      expect(invalidated).toEqual([
        ["brands", "detail", "brand-1"],
        ["brands", "list"],
        ["brand-stripe-status", "brand-1"],
        ["brand-paystack", "status", "brand-1"],
      ]);

      // No brand: nothing to refresh.
      const none: unknown[] = [];
      const spy = {
        invalidateQueries: ((filters: { queryKey: unknown }) => {
          none.push(filters.queryKey);
          return Promise.resolve();
        }) as never,
      };
      mod.refreshBrandPaymentState(spy, null);
      mod.refreshBrandPaymentState(spy, "");
      expect(none).toEqual([]);

      // It runs from an unmount cleanup: a throwing cache must not escape.
      expect(() =>
        mod.refreshBrandPaymentState(
          {
            invalidateQueries: (() => {
              throw new Error("cache unavailable");
            }) as never,
          },
          "brand-1",
        ),
      ).not.toThrow();
    });
  });

  test("the two rail-status keys the helper imports are the real factories' keys", () => {
    expect(read("src/hooks/useBrandStripeStatus.ts")).toContain(
      'all: ["brand-stripe-status"] as const',
    );
    const paystack = read("src/hooks/useBrandPaystack.ts");
    expect(paystack).toContain('all: ["brand-paystack"] as const');
    expect(paystack).toContain('[...brandPaystackKeys.all, "status", brandId] as const');
  });
});
