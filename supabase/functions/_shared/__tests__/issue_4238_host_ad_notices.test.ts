// Issue #4238 W4b (amendment B §1, §9) — Host ad notices on the Host rail.
//
// @invariant I-4238-AD-NOTICE-ONCE
//   owner: supabase/functions/_shared/hostAdNotices.ts (idempotency keys) +
//          notify-dispatch notifications.idempotency_key
//   rule: every Host ad notice has a stable key per event (live per plan,
//         rejected per version, part per rejected-id set, paused per pause
//         row, credit low per latest top-up, ended per plan, signals per
//         automation row), suffixed per recipient, so a repeat sweep sends
//         nothing new. "Ended" waits for the settled hold.
// @invariant I-4238-HOST-ADS-ALL-LOCALES
//   owner: supabase/functions/_shared/hostAdNoticeCopy.ts
//   rule: every notice copy key exists in all 29 Host locales with the same
//         {placeholders} as English.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideCreditLowNotice,
  decideEndedNotice,
  decidePauseNotice,
  decideReviewNotices,
  decideSignalNotice,
  escapeDetail,
  HOST_AD_NOTICE_TYPES,
  type HostAdNotice,
  hostAdNoticeRecipients,
  type HostAdPlanRef,
  renderHostAdNotice,
  sendHostAdNotices,
} from "../hostAdNotices.ts";
import {
  HOST_AD_NOTICE_COPY,
  HOST_AD_NOTICE_COPY_KEYS,
  HOST_AD_NOTICE_LOCALES,
  hostAdNoticeLocale,
} from "../hostAdNoticeCopy.ts";
import { HOST_AD_REJECTION_REASONS } from "../hostAdRejectionReasons.ts";

// ── A small fake of the supabase-js query builder ──────────────────────────
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          rows = rows.filter((row) => row[col] === value);
          return builder;
        },
        is: (col: string, value: unknown) => {
          rows = rows.filter((row) => (row[col] ?? null) === value);
          return builder;
        },
        not: (col: string, _op: string, value: unknown) => {
          rows = rows.filter((row) => (row[col] ?? null) !== value);
          return builder;
        },
        in: (col: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[col]));
          return builder;
        },
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

const BRAND = "b0000000-0000-4000-8000-000000000001";
const OTHER_BRAND = "b0000000-0000-4000-8000-000000000002";
const owner = "u-owner",
  admin = "u-admin",
  marketing = "u-marketing",
  finance = "u-finance",
  events = "u-events",
  removed = "u-removed";
function team(): Record<string, Row[]> {
  const member = (user_id: string, role: string, extra: Row = {}) => ({
    brand_id: BRAND,
    user_id,
    role,
    accepted_at: "2026-11-01",
    removed_at: null,
    ...extra,
  });
  return {
    brands: [{ id: BRAND, account_id: owner }, {
      id: OTHER_BRAND,
      account_id: "u-x",
    }],
    brand_team_members: [
      member(admin, "brand_admin"),
      member(marketing, "marketing_manager"),
      member(finance, "finance_manager"),
      member(events, "event_manager"),
      member(removed, "brand_admin", { removed_at: "2026-11-10" }),
    ],
    profiles: [{ id: admin, preferred_language: "fr" }],
  };
}
const plan: HostAdPlanRef = {
  planId: "p1",
  brandId: BRAND,
  versionId: "v1",
  creatorId: events,
  eventTitle: "Lagos Rooftop",
};
type Sent = {
  userId: string;
  type: string;
  idempotencyKey: string;
  title: string;
  body: string;
};
function recorder() {
  const sent: Sent[] = [];
  const seen = new Set<string>();
  // notify-dispatch's idempotency check: one row per key.
  const dispatch = (input: Sent) => {
    if (!seen.has(input.idempotencyKey)) {
      seen.add(input.idempotencyKey);
      sent.push(input);
    }
    return Promise.resolve({ ok: true });
  };
  return { sent, dispatch };
}
const money = (cents: number, currency: string) => `${currency} ${cents / 100}`;

Deno.test("SC-B1.1: two sweeps of the same approval send one ad_live per recipient", async () => {
  const db = fakeDb(team());
  const ads = [{ id: "a1", platform: "meta", review_status: "ACTIVE" }];
  const { sent, dispatch } = recorder();
  await sendHostAdNotices(db, decideReviewNotices({ plan, ads }), dispatch);
  await sendHostAdNotices(db, decideReviewNotices({ plan, ads }), dispatch);
  const live = sent.filter((row) => row.type === "business.ad_live");
  assertEquals(
    live.map((row) => row.userId).sort(),
    [admin, events, marketing, owner].sort(),
  );
  assert(live.every((row) => row.idempotencyKey.startsWith("ad:p1:live:")));
});

Deno.test("SC-B1.2: 1 of 3 rejected (text-heavy) → part_rejected with reason and fix; finance gets none", async () => {
  const db = fakeDb(team());
  const ads = [
    {
      id: "a1",
      platform: "meta",
      review_status: "DISAPPROVED",
      review_detail: {
        ad_review_feedback: {
          global: { "Text": "Your image contains too much text" },
        },
      },
    },
    { id: "a2", platform: "meta", review_status: "ACTIVE" },
    { id: "a3", platform: "meta", review_status: "PENDING_REVIEW" },
  ];
  const notices = decideReviewNotices({ plan, ads });
  const part = notices.find((n) => n.type === "business.ad_part_rejected");
  assert(part);
  assertEquals(part.bodyKeys, [
    "reason_text_heavy",
    "fix_text_heavy",
    "part_suffix",
  ]);
  const { sent, dispatch } = recorder();
  await sendHostAdNotices(db, [part], dispatch);
  assertEquals(
    sent.map((row) => row.userId).sort(),
    [admin, events, marketing, owner].sort(),
  );
  assert(!sent.some((row) => row.userId === finance || row.userId === removed));
  const ownerRow = sent.find((row) => row.userId === owner);
  assertEquals(
    ownerRow?.title,
    "Instagram and Facebook didn't approve 1 of your ads",
  );
  assertEquals(
    ownerRow?.body,
    "The image has too much text. Use a photo with less writing on it. Your other ads keep running.",
  );
  // The admin reads it in French.
  assertEquals(
    sent.find((row) => row.userId === admin)?.title,
    "Instagram and Facebook n'a pas approuvé 1 de vos pubs",
  );
});

Deno.test("SC-B1.3: an unmapped code gives the fallback copy, never the raw code", () => {
  const [notice] = decideReviewNotices({
    plan,
    ads: [{
      id: "a1",
      platform: "snapchat",
      review_status: "REJECTED",
      review_detail: { review_status_reasons: ["XQZ_4417"] },
    }],
  });
  assertEquals(notice.type, "business.ad_rejected");
  const copy = renderHostAdNotice(notice, "en");
  assertEquals(copy.title, "Snapchat didn't approve your ad");
  assertEquals(
    copy.body,
    "Snapchat didn't approve 1 of your ads. Open the ad to see what to change.",
  );
  assert(!copy.title.includes("XQZ") && !copy.body.includes("XQZ"));
});

Deno.test("SC-B1.4: a sold-out pause says sold out; teammate A's pause skips A", async () => {
  const soldOut = decidePauseNotice({
    plan,
    reason: "sold_out",
    pauseRef: "e1",
  });
  assertEquals(
    renderHostAdNotice(soldOut, "en").body,
    "Lagos Rooftop is sold out, so your ad stopped. Nothing more is spent.",
  );
  assertEquals(
    decidePauseNotice({ plan, reason: "cap_98_percent", pauseRef: "e2" })
      .bodyKeys,
    ["paused_credit_out"],
  );
  assertEquals(
    decidePauseNotice({ plan, reason: "spend_fetch_failed", pauseRef: "e3" })
      .bodyKeys,
    ["paused_safety"],
  );
  assertEquals(
    decidePauseNotice({ plan, reason: "weird", pauseRef: "e4" }).bodyKeys,
    ["paused_generic"],
  );
  const byAdmin = decidePauseNotice({
    plan,
    reason: "host_paused",
    pauseRef: "host:k",
    actorId: admin,
    actorName: "Ada",
  });
  assertEquals(
    renderHostAdNotice(byAdmin, "en").body,
    "Ada paused your ad. You can turn it back on any time.",
  );
  const db = fakeDb(team());
  const { sent, dispatch } = recorder();
  await sendHostAdNotices(db, [byAdmin], dispatch);
  assert(!sent.some((row) => row.userId === admin));
  assert(sent.some((row) => row.userId === owner));
});

Deno.test("SC-B1.5 (W4c): a running ad whose held budget runs out >2 days early, with no free credit to extend it, fires once per top-up", async () => {
  const NOW = Date.parse("2026-11-16T00:00:00Z");
  const base = {
    brandId: BRAND,
    planId: "plan-1",
    campaignId: "camp-1",
    currency: "NGN",
    // ₦10,000 of held budget left at ₦6,000/day: stops in ~1.7 days.
    remainingProviderCents: 1_000_000,
    dailySpendCents: [600_000, 600_000, 600_000],
    plannedDailyCents: 0,
    hostPerProvider: 1,
    endsAtMs: NOW + 10 * 86_400_000,
    nowMs: NOW,
    freeCreditCents: 0,
    minTopUpPayCents: 2_500_000,
    formatMoney: money,
  };
  const first = decideCreditLowNotice({ ...base, latestTopUpLedgerId: "L1" });
  assert(first);
  // To the end date: 10 × ₦6,000 − ₦10,000 = ₦50,000; ÷ 0.85 = ₦58,823.53; up to the ₦500 step = ₦59,000.
  assertEquals(
    (first.details as { suggested_top_up_pay_cents: number })
      .suggested_top_up_pay_cents,
    5_900_000,
  );
  assertEquals(first.params.date, "2026-11-17");
  assertEquals(first.idempotencyKey, "ad:camp-1:credit_low:L1");
  const db = fakeDb(team());
  const { sent, dispatch } = recorder();
  await sendHostAdNotices(db, [first], dispatch);
  await sendHostAdNotices(db, [
    decideCreditLowNotice({ ...base, latestTopUpLedgerId: "L1" })!,
  ], dispatch);
  const afterFirst = sent.length;
  // Money audience: owner, admin, finance — not marketing, not the events manager.
  assertEquals(
    sent.map((row) => row.userId).sort(),
    [admin, finance, owner].sort(),
  );
  await sendHostAdNotices(db, [
    decideCreditLowNotice({ ...base, latestTopUpLedgerId: "L2" })!,
  ], dispatch);
  assertEquals(sent.length, afterFirst + 3);
  // Free credit already covers the run to the end date: nothing (adversarial).
  assertEquals(
    decideCreditLowNotice({
      ...base,
      freeCreditCents: 5_000_000,
      latestTopUpLedgerId: "L3",
    }),
    null,
  );
  // Free credit covers part: the top-up is only the rest, in pay terms.
  const part = decideCreditLowNotice({
    ...base,
    freeCreditCents: 4_000_000,
    latestTopUpLedgerId: "L3",
  });
  // ₦10,000 short ÷ 0.85 = ₦11,764.71 → ₦12,000, but never below the ₦25,000 minimum.
  assertEquals(
    (part!.details as { suggested_top_up_pay_cents: number })
      .suggested_top_up_pay_cents,
    2_500_000,
  );
  // Runs out within 2 days of the end date: nothing.
  assertEquals(
    decideCreditLowNotice({
      ...base,
      endsAtMs: NOW + 3 * 86_400_000,
      latestTopUpLedgerId: "L4",
    }),
    null,
  );
  // Held budget reaches the end date: nothing, however low the free balance.
  assertEquals(
    decideCreditLowNotice({
      ...base,
      remainingProviderCents: 6_000_000,
      latestTopUpLedgerId: "L4",
    }),
    null,
  );
  // Fewer than 3 days of spend: the planned daily is used.
  assert(
    decideCreditLowNotice({
      ...base,
      dailySpendCents: [10],
      plannedDailyCents: 600_000,
      latestTopUpLedgerId: "L4",
    }),
  );
  // An ad in another currency is compared at its own rate: $40 held at
  // $30/day, ₦1,600 per $1, 10 days → $260 short = ₦416,000 > ₦0 free.
  const fx = decideCreditLowNotice({
    ...base,
    remainingProviderCents: 4_000,
    dailySpendCents: [3_000, 3_000, 3_000],
    hostPerProvider: 1_600,
    latestTopUpLedgerId: "L5",
  });
  assertEquals(
    (fx!.details as { need_host_cents: number }).need_host_cents,
    41_600_000,
  );
  // No end date or a past one: nothing.
  assertEquals(
    decideCreditLowNotice({
      ...base,
      endsAtMs: NaN,
      latestTopUpLedgerId: "L6",
    }),
    null,
  );
  assertEquals(
    decideCreditLowNotice({
      ...base,
      endsAtMs: NOW - 1,
      latestTopUpLedgerId: "L6",
    }),
    null,
  );
});

Deno.test("SC-B1.6: ad_ended waits for the settled hold and states the ledger's return", () => {
  const held = { state: "held", amount_cents: 1_000_000, currency: "NGN" };
  assertEquals(
    decideEndedNotice({
      plan,
      hold: held,
      release: null,
      results: 4,
      formatMoney: money,
    }),
    null,
  );
  assertEquals(
    decideEndedNotice({
      plan,
      hold: null,
      release: null,
      results: 4,
      formatMoney: money,
    }),
    null,
  );
  const settled = { ...held, state: "settled" };
  const back = decideEndedNotice({
    plan,
    hold: settled,
    release: { amount_cents: 250_000, final_host_spend_cents: 750_000 },
    results: 4,
    formatMoney: money,
  })!;
  assertEquals(back.idempotencyKey, "ad:p1:ended");
  assertEquals(
    renderHostAdNotice(back, "en").body,
    "Spent NGN 7500. Results counted by Mingla: 4. NGN 2500 of unused credit is back in your balance.",
  );
  const none = decideEndedNotice({
    plan,
    hold: settled,
    release: null,
    results: 0,
    formatMoney: money,
  })!;
  assertEquals(
    renderHostAdNotice(none, "en").body,
    "Spent NGN 10000. Results counted by Mingla: 0. Nothing was left over.",
  );
});

Deno.test("signals: slow sales, tired creative and last tickets, once per recorded row", () => {
  const kinds = ["slow_sales_nudge", "creative_fatigue", "low_stock_copy"];
  const types = kinds.map((kind) =>
    decideSignalNotice({
      plan,
      event: { id: `e-${kind}`, kind, platform: "tiktok" },
    })?.type
  );
  assertEquals(types, [
    "business.ad_slow_sales",
    "business.ad_creative_tired",
    "business.ad_last_tickets",
  ]);
  assertEquals(
    decideSignalNotice({ plan, event: { id: "x", kind: "goal_promoted" } }),
    null,
  );
  assertEquals(
    decideSignalNotice({ plan, event: { id: "e9", kind: "creative_fatigue" } })
      ?.idempotencyKey,
    "ad:p1:creative_fatigue:e9",
  );
});

Deno.test("adversarial: another brand's plan reaches nobody on this team; removed and unaccepted never", async () => {
  const db = fakeDb(team());
  const notice: HostAdNotice = {
    ...decidePauseNotice({
      plan: { ...plan, brandId: OTHER_BRAND, creatorId: admin },
      reason: "sold_out",
      pauseRef: "z",
    }),
  };
  const ids = await hostAdNoticeRecipients(db, notice);
  assertEquals(
    ids,
    ["u-x"],
    "only the other brand's owner; our admin (as creator) is not on that team",
  );
});

Deno.test("adversarial: 100 rejections → one notice; HTML in a reason is escaped", () => {
  const ads = Array.from({ length: 100 }, (_, i) => ({
    id: `a${i}`,
    platform: "reddit",
    review_status: "REJECTED",
    review_detail: {
      rejection_reason: "<script>alert(1)</script> misleading claim",
    },
  }));
  const notices = decideReviewNotices({ plan, ads });
  assertEquals(notices.length, 1);
  assertEquals(notices[0].params.n, 100);
  assertEquals(notices[0].bodyKeys, ["reason_misleading", "fix_misleading"]);
  const text = JSON.stringify(notices[0].details);
  assert(!text.includes("<script>"));
  assertEquals(escapeDetail("<b>hi</b> <img src=x onerror=1>"), "hi");
});

Deno.test("I-4238-AD-NOTICE-ONCE: the keys are stable and distinct per event", () => {
  const ads = [{ id: "a2", platform: "meta", review_status: "DISAPPROVED" }, {
    id: "a1",
    platform: "meta",
    review_status: "ACTIVE",
  }];
  const one = decideReviewNotices({ plan, ads }).map((n) => n.idempotencyKey);
  const two = decideReviewNotices({ plan, ads: [...ads].reverse() }).map((n) =>
    n.idempotencyKey
  );
  assertEquals(one, two);
  const more = decideReviewNotices({
    plan,
    ads: [...ads, { id: "a3", platform: "meta", review_status: "DISAPPROVED" }],
  });
  assert(
    more.find((n) => n.type === "business.ad_part_rejected")!.idempotencyKey !==
      one[1],
  );
  assertEquals(
    decidePauseNotice({ plan, reason: "sold_out", pauseRef: "e1" })
      .idempotencyKey,
    "ad:p1:paused:e1",
  );
});

Deno.test("I-4238-HOST-ADS-ALL-LOCALES: every key in all 29 locales, placeholders match English", () => {
  assertEquals(HOST_AD_NOTICE_LOCALES.length, 29);
  const placeholders = (value: string) =>
    [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const english = HOST_AD_NOTICE_COPY.en;
  for (const locale of HOST_AD_NOTICE_LOCALES) {
    const copy = HOST_AD_NOTICE_COPY[locale] as Record<string, string>;
    assertEquals(
      Object.keys(copy).sort(),
      [...HOST_AD_NOTICE_COPY_KEYS].sort(),
      `keys in ${locale}`,
    );
    for (const key of HOST_AD_NOTICE_COPY_KEYS) {
      assert(
        typeof copy[key] === "string" && copy[key].trim(),
        `${locale}.${key} empty`,
      );
      assertEquals(
        placeholders(copy[key]),
        placeholders(english[key]),
        `${locale}.${key} placeholders`,
      );
      if (locale !== "en") {
        assert(copy[key] !== english[key], `${locale}.${key} untranslated`);
      }
    }
  }
  // Every rejection class's reason and fix keys exist.
  for (const entry of HOST_AD_REJECTION_REASONS) {
    assert(
      (HOST_AD_NOTICE_COPY_KEYS as readonly string[]).includes(
        entry.reason_key,
      ),
    );
    assert(
      (HOST_AD_NOTICE_COPY_KEYS as readonly string[]).includes(entry.fix_key),
    );
  }
  // The server catalog covers the Host app's 29 locale folders exactly.
  const folders = [
    ...Deno.readDirSync(
      new URL("../../../../mingla-business/src/i18n/locales/", import.meta.url),
    ),
  ]
    .filter((entry) => entry.isDirectory).map((entry) => entry.name).sort();
  assertEquals(folders, [...HOST_AD_NOTICE_LOCALES].sort());
  assertEquals(hostAdNoticeLocale("pt-BR"), "pt");
  assertEquals(hostAdNoticeLocale("xx"), "en");
  assertEquals(hostAdNoticeLocale(null), "en");
});

Deno.test("the nine types are preference-aware in notify-dispatch and accepted by the migration", async () => {
  const dispatchSrc = await Deno.readTextFile(
    new URL("../../notify-dispatch/index.ts", import.meta.url),
  );
  assert(dispatchSrc.includes("...HOST_AD_NOTICE_CHANNEL_DEFAULTS"));
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20280713004238_issue_4238_host_ad_notices_roles.sql",
      import.meta.url,
    ),
  );
  for (const type of HOST_AD_NOTICE_TYPES) {
    assert(sql.includes(`'${type}'`), type);
  }
  for (
    const [fn, hook] of [
      ["admin-ad-campaign-sync", "decideReviewNotices({ plan, ads: rows })"],
      ["admin-ad-spend-sync", "notifyHostAdEnded("],
      ["admin-ad-spend-sync", "notifyHostAdPause(supabase"],
      ["admin-ad-spend-sync", "notifyHostAdCreditLow("],
      ["admin-ad-spend-sync", "notifyHostAdSignals("],
      ["host-ad-campaign", 'reason: "host_paused"'],
    ]
  ) {
    const src = await Deno.readTextFile(
      new URL(`../../${fn}/index.ts`, import.meta.url),
    );
    assert(src.includes(hook), `${fn} calls ${hook}`);
  }
});
