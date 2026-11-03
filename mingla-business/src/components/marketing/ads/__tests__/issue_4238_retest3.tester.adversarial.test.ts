/**
 * #4238 — tester RETEST 3 adversarial suite (Business app side). Angles the
 * implementor's retest-2 tests do not cover:
 *
 *  FAB.   The floating "Create an ad" rule is checked against the REAL route
 *         files under app/(tabs)/marketing/ads (every page except the Ads
 *         list hides it; trailing slash, query-free list and other marketing
 *         tabs keep it), using the regex taken from the layout source itself.
 *  Logout The Ads setup cache is cleared by the real clearAllStores() sign-out
 *         path, even when another registered cleanup throws first.
 *  Words. The Ads list built by buildHostAdList: a draft at every builder
 *         step reads "Saved at: <step name>", a review reason code in any
 *         case reads as the sentence, and every line passes the plain scan.
 *
 * Fails on revert (verified by line-deletion at the retest-3 commit):
 *  - layout without `HOST_AD_SUBPAGE_RE.test(pathname)` → create / detail
 *    keep the floating button.
 *  - hostAdSetupCache without registerSignOutCleanup → the next sign-in is
 *    served the previous person's setup.
 *  - draftItem back to `Saved at ${current_step}` or planItem without
 *    hostAdReviewReason → raw codes on the list.
 */

import fs from "node:fs";
import path from "node:path";

import { cachedHostAdSetup, clearHostAdSetupCache } from "../hostAdSetupCache";
import { hostAdCopyIsPlain } from "../hostAdCopy";
import { registerSignOutCleanup } from "../../../../utils/signOutCleanups";
import { buildHostAdList } from "../../../../services/hostAdLifecycle";
import type {
  HostAdDraft,
  HostAdPlanAggregate,
} from "../../../../services/hostAdPlanService";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("#4238 RETEST3 the floating Create an ad button and the real routes", () => {
  const layout = read("app/(tabs)/marketing/_layout.tsx");
  const literal = /const HOST_AD_SUBPAGE_RE = \/(.+)\/;/.exec(layout)?.[1];
  // The layout's own hide rule, exactly as shipped.
  const hides = (pathname: string) =>
    pathname.includes("/campaigns/compose") ||
    (literal !== undefined &&
      new RegExp(literal).test(pathname) &&
      layout.includes("HOST_AD_SUBPAGE_RE.test(pathname)"));

  it("hides on every ad page except the Ads list", () => {
    expect(literal).toBeDefined();
    const files = fs
      .readdirSync(path.join(ROOT, "app/(tabs)/marketing/ads"))
      .filter((file) => /\.tsx$/.test(file) && !file.startsWith("_"));
    expect(files).toEqual(expect.arrayContaining(["index.tsx", "create.tsx", "[id].tsx"]));
    for (const file of files) {
      const segment = file.replace(/\.tsx$/, "");
      const pathname =
        segment === "index"
          ? "/marketing/ads"
          : `/marketing/ads/${segment.replace(/^\[.+\]$/, "d4238000-0000-4000-8000-000000000003")}`;
      expect({ pathname, hidden: hides(pathname) }).toEqual({
        pathname,
        hidden: segment !== "index",
      });
    }
  });

  it("keeps the button on the list, a trailing slash and the other tabs", () => {
    for (const pathname of [
      "/marketing/ads",
      "/marketing/ads/",
      "/marketing",
      "/marketing/campaigns",
      "/marketing/adsense/x",
      "/marketing/creators",
    ]) {
      expect({ pathname, hidden: hides(pathname) }).toEqual({ pathname, hidden: false });
    }
  });
});

describe("#4238 RETEST3 sign-out clears the Ads setup cache through clearAllStores", () => {
  beforeEach(() => clearHostAdSetupCache());

  it("the next person never gets the previous person's setup", async () => {
    // A cleanup registered before ours that throws must not stop ours.
    const unregister = registerSignOutCleanup(() => {
      throw new Error("another cleanup failed");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const first = await cachedHostAdSetup("brand-a", async () => ({ who: "host-a" }), { now: 1 });
      expect(first).toEqual({ who: "host-a" });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { clearAllStores } = require("../../../../utils/clearAllStores") as {
        clearAllStores: () => unknown;
      };
      await clearAllStores();
      const next = await cachedHostAdSetup("brand-a", async () => ({ who: "host-b" }), { now: 2 });
      expect(next).toEqual({ who: "host-b" });
    } finally {
      unregister();
      warn.mockRestore();
    }
  });
});

describe("#4238 RETEST3 the Ads list words, built by buildHostAdList", () => {
  const draft = (step: string, n: number): HostAdDraft => ({
    id: `draft-${n}`,
    client_kind: "host",
    owner_kind: "host",
    brand_id: "brand-a",
    plan_id: null,
    revision: 1,
    current_step: step,
    draft_state: {},
    updated_at: `2026-11-0${n}T00:00:00.000Z`,
  });
  const plan = (reason: string, n: number): HostAdPlanAggregate =>
    ({
      plan: {
        id: `plan-${n}`,
        state: "staff_review_required",
        current_version_id: `v-${n}`,
        destination_key: "event:femzy:deserted-island",
        review_required: true,
        review_reasons: [reason],
        updated_at: `2026-10-0${n}T00:00:00.000Z`,
        brand_id: "brand-a",
        owner_kind: "host",
      },
      version: {
        id: `v-${n}`,
        plan_hash: "a".repeat(64),
        host_currency: "NGN",
        host_budget_cents: 150_000_000,
        canonical_plan: { name: "Deserted Island — December" },
      },
      provider_allocations: [],
      targeting_snapshots: [],
      reviews: [],
      funding_hold: null,
      provider_attempts: [],
      campaigns: [],
    }) as HostAdPlanAggregate;

  it("names every builder step and words every review code", () => {
    const items = buildHostAdList({
      drafts: [
        draft("promote", 1),
        draft("audience", 2),
        draft("budget", 3),
        draft("creative", 4),
        draft("review", 5),
      ],
      plans: [plan("first_three_host_campaigns", 1), plan("FIRST_THREE_HOST_CAMPAIGNS", 2)],
      campaigns: [],
    });
    const reasons = items.map((item) => item.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "Saved at: What you're promoting",
        "Saved at: Who sees it",
        "Saved at: Budget and dates",
        "Saved at: Video and words",
        "Saved at: Review and launch",
      ]),
    );
    expect(
      reasons.filter((r) => r === "Mingla checks a brand's first three ads before they run"),
    ).toHaveLength(2);
    for (const item of items) {
      for (const line of [item.reason ?? "", item.primaryResultLabel, item.nextAction]) {
        expect({ line, plain: hostAdCopyIsPlain(line) }).toEqual({ line, plain: true });
      }
      expect(item.reason).not.toMatch(/_|\bSaved at (promote|audience|budget|creative|review)\b/);
    }
  });
});
