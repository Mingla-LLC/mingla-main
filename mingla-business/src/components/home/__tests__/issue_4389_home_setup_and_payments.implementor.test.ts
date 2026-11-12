/**
 * #4389 H1 / H2 / HT — Home's setup card, one-time sheet, Tap to Pay card and
 * "Take a payment"; businessTodos' one checklist-driven row.
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import { buildBusinessTodos, type BusinessTodoInput } from "../../../utils/businessTodos";
import {
  doorEventIdsToday,
  doorTodaySummary,
  homeTapCardMode,
} from "../../../utils/homeTakePayment";
import { HOME_SETUP_COPY } from "../homeSetupCopy";
import { BRAND_SETUP_BANNED_WORDS } from "../../brand/brandSetupCopy";
import type { DoorSaleRecord } from "../../../types/doorSales";
import type { UpcomingItem } from "../../../utils/upcomingBuilder";

const BIZ = path.join(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ, rel), "utf8");

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: null,
  pipelineRoute: "",
  venueDraftInProgress: false,
  counts: { total: 1, live: 1, draft: 0 },
  stripeActive: false,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "",
  brandReadiness: {
    status: "ready",
    brandId: "b1",
    editRoute: "/brand/b1/edit",
    hideBrandRows: false,
    items: [
      { key: "address", state: "missing", canCallerFix: true, whoCanFix: "you" },
      { key: "city_country", state: "missing", canCallerFix: true, whoCanFix: "you" },
      { key: "tagline", state: "missing", canCallerFix: true, whoCanFix: "you" },
    ],
  } as unknown as BusinessTodoInput["brandReadiness"],
};
const ids = (input: BusinessTodoInput): string[] => buildBusinessTodos(input).map((t) => t.id);

describe("#4389 businessTodos — one checklist-driven row", () => {
  test("setup incomplete: one Finish setting up row; no bank or address literals", () => {
    const todos = buildBusinessTodos({
      ...base,
      brandSetup: { brandName: "Lantern Room", doneCount: 2, complete: false, waitingFor: null, route: "/brand/b1/setup" },
    });
    const list = todos.map((t) => t.id);
    expect(list).toContain("finish_brand_setup");
    expect(list).not.toContain("connect_stripe");
    expect(list).not.toContain("profile_add_address");
    expect(list).not.toContain("profile_add_city_country");
    expect(list).toContain("profile_add_tagline");
    const row = todos.find((t) => t.id === "finish_brand_setup");
    expect(row?.label).toBe("Finish setting up Lantern Room");
    expect(row?.sublabel).toBe("2 of 4 done");
    expect(row?.action).toEqual({ kind: "route", route: "/brand/b1/setup" });
  });
  test("waiting for a client: the row says so and is not tappable", () => {
    const row = buildBusinessTodos({
      ...base,
      brandSetup: { brandName: "X", doneCount: 2, complete: false, waitingFor: "Ada", route: "/r" },
    }).find((t) => t.id === "finish_brand_setup");
    expect(row?.sublabel).toBe("Waiting for Ada");
    expect(row?.action).toEqual({ kind: "info" });
  });
  test("setup complete: no setup row and still no Connect bank literal", () => {
    const list = ids({
      ...base,
      brandSetup: { brandName: "X", doneCount: 4, complete: true, waitingFor: null, route: "/r" },
    });
    expect(list).not.toContain("finish_brand_setup");
    expect(list).not.toContain("connect_stripe");
  });
  test("Tap to Pay after Not now is the first brand row", () => {
    const list = ids({
      ...base,
      tapToPayTodo: { label: "Set up Tap to Pay on iPhone", sublabel: "s", route: "/account/tap-to-pay?brandId=b1" },
    });
    expect(list[0]).toBe("set_up_tap_to_pay");
  });
});

describe("#4389 HT rules", () => {
  const day = new Date(2026, 10, 11, 20, 0, 0);
  const sale = (over: Partial<DoorSaleRecord>): DoorSaleRecord =>
    ({
      recordedAt: new Date(2026, 10, 11, 19, 0).toISOString(),
      status: "completed",
      totalGbpAtSale: 25,
      totalAtSale: 25,
      refundedAmountGbp: 0,
      refundedAmount: 0,
      currency: "USD",
      ...over,
    }) as DoorSaleRecord;
  test("At the door today counts today's sales, any method, net of refunds", () => {
    const s = doorTodaySummary(
      [
        sale({}),
        sale({ totalAtSale: 60, refundedAmount: 10, status: "refunded_partial" }),
        sale({ status: "refunded_full" }),
        sale({ recordedAt: new Date(2026, 10, 10, 19).toISOString() }),
      ],
      day,
    );
    expect(s).toEqual({ count: 2, totalMajor: 75, currency: "USD" });
    expect(HOME_SETUP_COPY.takePayment.atDoorToday(2, "$75.00")).toBe("At the door today · 2 sales · $75.00");
  });
  test("door events today: live now or starting today; never drafts or trips", () => {
    const item = (id: string, kind: UpcomingItem["kind"], start: Date | null): UpcomingItem =>
      ({ key: id, id, kind, status: "upcoming", startAtUtc: start, endAtUtc: null, source: {} }) as UpcomingItem;
    expect(
      doorEventIdsToday(
        [item("live", "event", null)],
        [item("tonight", "event", new Date(2026, 10, 11, 22)), item("tomorrow", "event", new Date(2026, 10, 12, 22)), item("d", "draft", new Date(2026, 10, 11, 22))],
        day,
      ),
    ).toEqual(["live", "tonight"]);
  });
  test("the Tap to Pay card: never on web, gone after Not now or set up, owner line for others", () => {
    const ok = { os: "ios", entryShown: true, brandEligible: true, paymentsReady: true, notNow: false, needsSetup: true, mayAcceptTerms: true };
    expect(homeTapCardMode(ok)).toBe("ios");
    expect(homeTapCardMode({ ...ok, os: "android" })).toBe("android");
    expect(homeTapCardMode({ ...ok, os: "web" })).toBeNull();
    expect(homeTapCardMode({ ...ok, notNow: true })).toBeNull();
    expect(homeTapCardMode({ ...ok, needsSetup: false })).toBeNull();
    expect(homeTapCardMode({ ...ok, paymentsReady: false })).toBeNull();
    expect(homeTapCardMode({ ...ok, mayAcceptTerms: false })).toBe("owner");
  });
  test("Apple's exact words and naming; no banned words in Home copy", () => {
    expect(HOME_SETUP_COPY.ht.iosBody).toBe(
      "Accept physical debit and credit cards as well as Apple Pay and other digital wallets. Right on your iPhone.",
    );
    expect(HOME_SETUP_COPY.ht.terms).toBe("Terms apply.");
    expect(HOME_SETUP_COPY.ht.iosTitle).toBe("Tap to Pay on iPhone");
    const all = JSON.stringify(HOME_SETUP_COPY) +
      [HOME_SETUP_COPY.h1.title("B"), HOME_SETUP_COPY.h2.title("B"), HOME_SETUP_COPY.ht.notOwner("o", "b")].join(" ");
    for (const word of BRAND_SETUP_BANNED_WORDS) expect(all).not.toMatch(word);
  });
});

describe("#4389 Home wiring", () => {
  const home = read("app/(tabs)/home.tsx");
  test("the Tap to Pay row left Account; Home owns the card", () => {
    expect(read("app/(tabs)/account.tsx")).not.toContain("TapToPayIcon");
    expect(home).toContain("<LazyHomeTapToPayCard");
    expect(read("src/components/home/HomeTapToPayCard.tsx")).toContain('require("../../../assets/tap-to-pay/ttp-visual.png")');
  });
  test("Take a payment goes through openDoorSale; full-width button at the bottom of the money panel, chip under Ask Ari", () => {
    expect(read("src/components/home/HomeTakePayment.tsx")).toContain('await import("../../utils/openDoorSale")');
    // #4389 HT (Seth): full width at the bottom of the money panel, not the header.
    expect(home).toContain("moneyAction={takePaymentButton}");
    expect(home).toContain('variant="chip"');
    expect(home.indexOf("<HomeAskAri")).toBeLessThan(home.indexOf('variant="chip"'));
  });
  test("H2 is once per device per brand, owners and admins only, after hydration", () => {
    expect(home).toContain("!promptHydrated ||");
    expect(home).toContain("!mayManageSetup");
    expect(home).toContain("markPromptSeen(promptKey);");
    expect(read("src/utils/clearAllStores.ts")).toContain("useHomeSetupPromptStore.getState().reset();");
  });
  test("Home shows the K1 free-only toast", () => {
    expect(home).toContain('params.toast !== "free_only"');
    expect(home).toContain("BRAND_SETUP_COPY.k1.toast");
  });
  test("web: the Tap to Pay entry is null there, so no card, row or To do item", () => {
    expect(read("src/hooks/useTapToPaySettingsEntry.web.ts")).toContain("=> null;");
  });
});
