/**
 * issue #3645 — leaving bank setup refreshes the brand's payment state.
 *
 * A creator sends the host to bank setup and gets them back. On native, and on
 * an in-app web navigation, the creator was never unmounted, so the brand it
 * holds is the one from BEFORE the bank was connected and Publish would stay
 * disabled until a manual refresh. Both bank-setup views call
 * `refreshBrandPaymentState` as they unmount; that helper is executed here.
 *
 * The validation of the return target is executed in
 * `utils/__tests__/issue_3645_bank_setup_return.implementor.test.ts`. How each
 * surface is WIRED (reads the one validated param, returns to the creator,
 * keeps the brand-creation funnel's own return) is enforced by the strict-grep
 * gate `.github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs`, group A.
 */

import { describe, expect, jest, test } from "@jest/globals";

describe("#3645 — leaving bank setup refreshes the brand's payment state", () => {
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
});
