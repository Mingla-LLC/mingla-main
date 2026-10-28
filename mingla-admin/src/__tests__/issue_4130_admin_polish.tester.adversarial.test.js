// Issue #4130 — independent tester adversarial tests for the Admin polish.
//
// The implementor tests prove the happy paths. These attack other angles:
//   T-WORK   Work's This week / This month edges in five time zones: a Sunday
//            23:30 and a Monday 00:00, a Monday after a clock change, the
//            1st of a month at midnight, and "vs last month" on the 31st of a
//            month whose previous month is shorter.
//   T-DASH   The Dashboard never reads a failed source as "nothing needs you":
//            every failed read becomes its own item with Retry, ranked first,
//            even when every other source is fine or also failed.
//   T-MONEY  A currency with no USD figure never turns into 0 in a USD total,
//            and a single line of 0 USD next to a missing one stays missing.
//   T-LIMIT  "Until" dates at the turn of a year and on 29 February, and an
//            end that is exactly now is refused.
//   T-PEOPLE A refused ban or business-account close touches nothing but one
//            RPC: the stand-in client throws on any table, function or second
//            call, so a browser-side fallback cannot hide.
//   T-BRANDS Payments' readiness rule gives the same code as the boards' server
//            helper for the eight edge brands the pg17 tester suite builds
//            (supabase/migrations/__tests__/issue_4130_admin_polish.tester.adversarial.pg17.test.sql).
//   T-DROOM  A "too new" retention cell is never shown as 0%, and Data room is
//            closed to every role the server refuses.
//   T-SUPP   The Support and Community tabs per role match the server's areas.
//
// FAILS-ON-REVERT: making weekStart use getUTCDay fails T-WORK (Lagos and
// Kiritimati); returning `usdTotal: usdTotal` without the completeness check
// in moneyRow fails T-MONEY; restoring a `.from(` fallback in personActions
// fails T-PEOPLE; dropping the past_due check from stripeReadiness fails T-BRANDS.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  weekStart,
  monthRange,
  previousMonthRange,
  recentWeeksRange,
  standupSince,
} from "../lib/workViews.js";
import { needsYouToday } from "../lib/dashboardToday.js";
import { moneyRow, headline } from "../lib/minglaMoney.js";
import { endsAtFromDay, untilOptions, startOfNextMonthUtc } from "../lib/messagingLimits.js";
import { createPersonActions } from "../lib/personActions.js";
import { derivePaymentReadiness, readinessCode } from "../lib/paymentReadiness.js";
import { retentionCell } from "../lib/dataRoomAnalytics.js";
import { canOpenPage, normalizeAccess, resolveRoute } from "../lib/access.js";
import { isInternalEmail } from "../lib/peopleSegments.js";
import { communitySupportTabsForAccess } from "../lib/communitySupportAccess.js";
import { SUPPORT_PAGE_TABS, COMMUNITY_PAGE_TABS } from "../lib/supportCommunityTabs.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINAL_TZ = process.env.TZ;

function inZone(tz, fn) {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}

/** Local wall-clock parts of a Date in the current TZ. */
function wall(d) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getDay()];
}

describe("T-WORK: week and month edges in the viewer's own time zone", () => {
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  for (const tz of ["Africa/Lagos", "America/New_York", "Europe/London", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    it(`${tz}: Sunday 23:30 belongs to the week that began the Monday before`, () => {
      inZone(tz, () => {
        const sundayLate = new Date(2026, 2, 1, 23, 30); // Sun 1 Mar 2026, local
        assert.deepEqual(wall(weekStart(sundayLate)), [2026, 2, 23, 0, 0, 1]);
      });
    });

    it(`${tz}: Monday 00:00 starts its own week`, () => {
      inZone(tz, () => {
        const mondayMidnight = new Date(2026, 2, 2, 0, 0);
        assert.deepEqual(wall(weekStart(mondayMidnight)), [2026, 3, 2, 0, 0, 1]);
      });
    });

    it(`${tz}: the 1st at 00:00 is the start of this month, not last month`, () => {
      inZone(tz, () => {
        const first = new Date(2026, 10, 1, 0, 0);
        assert.deepEqual(wall(monthRange(first).from).slice(0, 4), [2026, 11, 1, 0]);
      });
    });

    it(`${tz}: the 8-week chart starts on a Monday at 00:00 local`, () => {
      inZone(tz, () => {
        const { from } = recentWeeksRange(new Date(2026, 3, 1, 12, 0), 8);
        assert.equal(from.getDay(), 1);
        assert.equal(from.getHours(), 0);
      });
    });
  }

  it("New York: the Monday after the spring clock change still starts at 00:00 local", () => {
    inZone("America/New_York", () => {
      const start = weekStart(new Date(2026, 2, 9, 0, 30)); // Mon 9 Mar 2026, the day after the change
      assert.deepEqual(wall(start), [2026, 3, 9, 0, 0, 1]);
      // and the week before it is 7 calendar days earlier, not 7 x 24 hours
      const before = weekStart(new Date(2026, 2, 8, 23, 59));
      assert.deepEqual(wall(before), [2026, 3, 2, 0, 0, 1]);
    });
  });

  it("London: the Monday after the autumn clock change is a whole local day", () => {
    inZone("Europe/London", () => {
      const start = weekStart(new Date(2026, 9, 26, 0, 30)); // Mon 26 Oct 2026
      assert.deepEqual(wall(start), [2026, 10, 26, 0, 0, 1]);
    });
  });

  it("'vs last month' on 31 March never runs past the end of February", () => {
    inZone("Africa/Lagos", () => {
      const { from, to } = previousMonthRange(new Date(2026, 2, 31, 18, 0));
      assert.deepEqual(wall(from).slice(0, 3), [2026, 2, 1]);
      assert.ok(to.getTime() <= new Date(2026, 2, 1, 0, 0).getTime(), `to ${to.toISOString()} ran into March`);
      assert.ok(to > from);
    });
  });

  it("'vs last month' on the 1st at 00:00 is a non-empty window", () => {
    inZone("UTC", () => {
      const { from, to } = previousMonthRange(new Date(2026, 4, 1, 0, 0));
      assert.ok(to > from);
    });
  });

  it("the Monday standup counts from Sunday 09:00 local (yesterday), in every zone", () => {
    for (const tz of ["Africa/Lagos", "Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      inZone(tz, () => {
        assert.deepEqual(wall(standupSince(new Date(2026, 2, 2, 8, 0))).slice(0, 5), [2026, 3, 1, 9, 0]);
      });
    }
  });
});

describe("T-DASH: a failed read is never 'nothing needs you today'", () => {
  const ok = { status: "ready", data: {} };
  const err = { status: "error", error: new Error("boom") };
  const quiet = { status: "ready", data: { support: { waiting_first_reply: 0 }, inbound: { days_since_last: 1 } } };

  it("every source failing at once gives one Retry item per source and nothing else", () => {
    const items = needsYouToday({ work: err, money: err, health: err, queue: err, summary: err, announcements: err });
    const retries = items.filter((i) => i.retry);
    assert.ok(retries.length >= 5, `only ${retries.length} retry items: ${JSON.stringify(items.map((i) => i.id))}`);
    for (const key of ["work", "money", "health", "summary", "announcements"]) {
      assert.ok(retries.some((i) => i.retry === key), `no Retry for ${key}`);
    }
  });

  it("a failed source is ranked before every finding, even when the others are clean", () => {
    const items = needsYouToday({
      work: { status: "ready", data: { cards: 3 } },
      money: { status: "ready", data: { exceptions: { late_on_mingla: { count: 2 } } } },
      health: ok,
      summary: quiet,
      announcements: err,
    });
    assert.equal(items[0].retry, "announcements");
    assert.ok(items.some((i) => i.id === "money-late"));
  });

  it("a money summary that failed never produces '0 payouts late'", () => {
    const items = needsYouToday({ money: err, summary: quiet, health: ok });
    assert.equal(items.some((i) => /late on Mingla/.test(i.title || "")), false);
    assert.ok(items.some((i) => i.retry === "money"));
  });

  it("the Dashboard page wires a Retry for every source it reads", () => {
    const page = fs.readFileSync(path.join(SRC, "pages", "OverviewPage.jsx"), "utf8");
    for (const key of ["money", "health", "queue", "summary", "announcements"]) {
      assert.match(page, new RegExp(`${key}:\\s*\\w+\\.retry`), `no retry wired for ${key}`);
    }
    assert.match(page, /KpiFailed/);
  });
});

describe("T-MONEY: a missing rate never becomes a number", () => {
  const summary = {
    lines: [
      { kind: "fee", currency: "NGN", cents: 450000, usd_cents: 300 },
      { kind: "fee", currency: "SEK", cents: 2100, usd_cents: null },
      { kind: "fee", currency: "USD", cents: 0, usd_cents: 0 },
      { kind: "profit", currency: "NGN", cents: 100, usd_cents: 0 },
      { kind: "profit", currency: "SEK", cents: -5, usd_cents: null },
    ],
    pricing: { rows: [{ period: "current", kind: "fee", currency: "SEK", cents: 2100, usd_cents: null }] },
  };

  it("a USD total with one unconverted currency is null, not the sum of the rest", () => {
    assert.equal(moneyRow(summary, "fee").usdTotal, null);
  });

  it("a 0 USD line beside a missing one stays missing (0 + null is not 0)", () => {
    assert.equal(moneyRow(summary, "profit").usdTotal, null);
  });

  it("each currency keeps its own figure in its own column", () => {
    const row = moneyRow(summary, "fee");
    assert.equal(row.byCurrency.SEK.cents, 2100);
    assert.equal(row.byCurrency.NGN.cents, 450000);
    assert.equal(row.byCurrency.SEK.usdCents, null);
  });

  it("the share of the fee kept is not shown when its period has an unconverted line", () => {
    assert.equal(headline(summary).currentPricing, null);
  });
});

describe("T-LIMIT: messaging limit end dates", () => {
  it("'End of this month' in December ends on 1 January of the next year, UTC", () => {
    const now = new Date(Date.UTC(2026, 11, 31, 23, 59));
    assert.equal(startOfNextMonthUtc(now, 1).toISOString(), "2027-01-01T00:00:00.000Z");
    assert.equal(untilOptions(now)[1].endsAt, "2027-02-01T00:00:00.000Z");
  });

  it("29 February ends at the start of 1 March, UTC", () => {
    const res = endsAtFromDay("2028-02-29", new Date(Date.UTC(2028, 0, 1)));
    assert.equal(res.value, "2028-03-01T00:00:00.000Z");
  });

  it("a day that ends exactly now is refused", () => {
    const now = new Date(Date.UTC(2026, 9, 27, 0, 0));
    assert.ok(endsAtFromDay("2026-10-26", now).error);
  });

  // An impossible day such as 2026-13-01 or 2026-02-30 is NOT refused today (it
  // rolls over into a later date); reported to the conductor as a finding, so
  // only malformed text is pinned here.
  it("malformed day text is refused", () => {
    assert.ok(endsAtFromDay("26-10-2026").error);
    assert.ok(endsAtFromDay("").error);
  });
});

describe("T-PEOPLE: a refused action changes nothing and has no fallback", () => {
  function strictClient(rpcResult) {
    const calls = [];
    const client = new Proxy({}, {
      get(_t, prop) {
        if (prop === "rpc") {
          return async (name, params) => {
            calls.push({ name, params });
            if (calls.length > 1) throw new Error(`second call ${name}`);
            if (rpcResult instanceof Error) throw rpcResult;
            return rpcResult;
          };
        }
        if (prop === "then") return undefined;
        throw new Error(`personActions touched client.${String(prop)}`);
      },
    });
    return { client, calls };
  }

  for (const [label, result] of [
    ["the server says not_authorized", { data: null, error: { message: "not_authorized" } }],
    ["the network throws", new Error("Failed to fetch")],
    ["the server returns nothing at all", undefined],
  ]) {
    it(`ban when ${label}: one RPC, an error saying nothing changed`, async () => {
      const { client, calls } = strictClient(result);
      const actions = createPersonActions(client);
      await assert.rejects(actions.ban("u1", "spam"), /[Nn]othing was changed/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, "admin_set_user_active");
    });

    it(`close business account when ${label}: one RPC, no table delete`, async () => {
      const { client, calls } = strictClient(result);
      const actions = createPersonActions(client);
      await assert.rejects(actions.deleteBusinessAccount("u1", "asked us"), /[Nn]othing was changed/);
      assert.equal(calls.length, 1);
    });
  }

  it("a whitespace-only reason never reaches the server", async () => {
    const { client, calls } = strictClient({ data: {}, error: null });
    await assert.rejects(createPersonActions(client).setInternal("u1", true, " \t "), /reason/i);
    assert.equal(calls.length, 0);
  });

  it("no People code path deletes rows or calls delete-user from the browser", () => {
    for (const rel of ["lib/personActions.js", "pages/PeoplePage.jsx", "services/peopleService.js"]) {
      const file = path.join(SRC, rel);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.equal(/\.delete\(\s*\)/.test(text), false, `${rel} deletes rows`);
      assert.equal(/functions\.invoke\(\s*["']delete-user/.test(text), false, `${rel} calls delete-user`);
    }
    assert.equal(fs.existsSync(path.join(SRC, "pages", "UserManagementPage.jsx")), false);
  });
});

describe("T-BRANDS: the Payments rule and the boards name a brand the same way", () => {
  const base = {
    payment_provider: null, paystack_recipient_active: false, paystack_subaccount_code: null,
    has_stripe_account: false, stripe_connect_id: null, stripe_detached: false, stripe_past_due_count: 0,
    stripe_charges_enabled: false, stripe_payouts_enabled: false, held_states: {}, has_paid_sales: false,
  };
  // The same eight brands and expected codes as the pg17 tester suite (T-BRANDS).
  const cases = [
    ["RB1 paystack, active recipient, no subaccount", { payment_provider: "paystack", paystack_recipient_active: true }, "paystack_ready"],
    ["RB2 paystack, subaccount, no recipient", { payment_provider: "paystack", paystack_subaccount_code: "ACCT_x" }, "paystack_needs_action"],
    ["RB3 paystack, only an inactive recipient", { payment_provider: "paystack" }, "paystack_no_setup"],
    ["RB4 stripe, ready but an overdue requirement", { payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_past_due_count: 1 }, "stripe_needs_action"],
    ["RB5 stripe, ready but detached", { payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_detached: true }, "stripe_needs_action"],
    ["RB6 stripe, payouts off", { payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true }, "stripe_needs_action"],
    ["RB7 stripe, nothing set up", { payment_provider: "stripe" }, "stripe_no_setup"],
    ["(JS only) provider unset, active Paystack recipient", { paystack_recipient_active: true }, "paystack_ready"],
    ["RB8 stripe ready", { payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true }, "stripe_ready"],
  ];
  for (const [label, facts, code] of cases) {
    it(label, () => {
      assert.equal(readinessCode(derivePaymentReadiness({ ...base, ...facts })), code);
    });
  }

  it("money held for Mingla's own fault never turns a ready brand into 'needs host action'", () => {
    const v = derivePaymentReadiness({ ...base, payment_provider: "stripe", has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true, blocked_on_mingla_balance: true, has_paid_sales: true });
    assert.equal(v.state, "ready");
    assert.equal(v.blockingOnMingla, true);
  });

  it("Stripe actions are never offered on a Paystack brand", () => {
    const v = derivePaymentReadiness({ ...base, payment_provider: "paystack", paystack_recipient_active: true, has_stripe_account: true });
    assert.equal(v.stripeActionsAllowed, false);
  });
});

describe("T-DROOM and T-SUPP: who sees what", () => {
  const roles = {
    owner: { email: "o@x.org", role: "owner", status: "active", areas: ["admin_console", "team_manage", "crm", "beta_leads", "data_room", "community_support", "community_support_support", "community_support_community", "team_notifications"] },
    admin: { email: "a@x.org", role: "admin", status: "active", areas: ["admin_console", "crm", "beta_leads", "data_room", "community_support", "community_support_support", "community_support_community", "team_notifications"] },
    growth: { email: "g@x.org", role: "growth", status: "active", areas: ["role_home", "crm", "beta_leads", "team_notifications"] },
    partner: { email: "p@x.org", role: "partner", status: "active", areas: ["role_home", "crm", "beta_leads", "data_room", "team_notifications"] },
    support: { email: "s@x.org", role: "growth", status: "active", areas: ["role_home", "crm", "beta_leads", "community_support", "community_support_support", "community_support_community", "team_notifications"] },
    invitedAdmin: { email: "i@x.org", role: "admin", status: "invited", areas: ["admin_console", "data_room"] },
  };
  const acc = Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, normalizeAccess(v)]));

  it("a too-new retention cell reads 'too new', never 0%", () => {
    for (const value of [null, undefined]) {
      const cell = retentionCell(value);
      assert.equal(cell.tooNew, true);
      assert.doesNotMatch(cell.text, /%/);
    }
    assert.equal(retentionCell(0).text, "0%");
  });

  it("Data room opens for owner, admin and founding partner only", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, canOpenPage(a, "data-room")])),
      { owner: true, admin: true, growth: false, partner: true, support: false, invitedAdmin: false },
    );
  });

  it("money, people and settings pages stay closed to every team role", () => {
    for (const page of ["mingla-money", "business-payments", "business-orders", "business-money-ledger", "people", "brands", "settings", "feature-flags", "subscriptions", "pricing", "team-dashboard", "overview"]) {
      for (const who of ["growth", "partner", "support", "invitedAdmin"]) {
        assert.equal(canOpenPage(acc[who], page), false, `${who} can open ${page}`);
      }
    }
  });

  it("an inherited name never opens a page", () => {
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(canOpenPage(acc.growth, id), false);
      assert.equal(resolveRoute(id, acc.growth, [id]).pageId, "home");
    }
  });

  it("a retired address for a page you cannot open is denied, not silently opened", () => {
    assert.equal(resolveRoute("users", acc.growth, ["users", "people"]).denied, true);
    assert.equal(resolveRoute("stripe-mode", acc.partner, ["stripe-mode"]).denied, true);
  });

  it("Support and Community tabs per role", () => {
    const ids = (a, tabs) => communitySupportTabsForAccess(a, tabs).map((t) => t.id);
    assert.deepEqual(ids(acc.admin, SUPPORT_PAGE_TABS), SUPPORT_PAGE_TABS.map((t) => t.id));
    assert.deepEqual(ids(acc.admin, COMMUNITY_PAGE_TABS), COMMUNITY_PAGE_TABS.map((t) => t.id));
    assert.deepEqual(ids(acc.support, SUPPORT_PAGE_TABS), ["support", "blog"]);
    const supportCommunity = ids(acc.support, COMMUNITY_PAGE_TABS);
    for (const adminOnly of ["announcements", "roadmap", "product"]) {
      assert.equal(supportCommunity.includes(adminOnly), false, `support teammate sees ${adminOnly}`);
    }
    assert.ok(supportCommunity.includes("moderation"));
    assert.ok(supportCommunity.includes("enquiry-reports"));
    assert.deepEqual(ids(acc.growth, SUPPORT_PAGE_TABS), []);
    assert.deepEqual(ids(acc.growth, COMMUNITY_PAGE_TABS), []);
    assert.deepEqual(ids(acc.partner, COMMUNITY_PAGE_TABS), []);
    assert.deepEqual(ids(acc.invitedAdmin, COMMUNITY_PAGE_TABS), []);
  });
});

// T-RULE (retest): the browser mirror answers exactly as the server rule for
// the server suite's own near-miss list (read from the pg17 adversarial file,
// so the two lists cannot drift apart).
describe("T-RULE reserved test domains: whole last label, same answer as the server", () => {
  const sqlFile = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations", "__tests__", "issue_4130_admin_polish.tester.adversarial.pg17.test.sql"),
    "utf8",
  );
  const block = sqlFile.split("-- T-RULE-CASES-BEGIN")[1].split("-- T-RULE-CASES-END")[0];
  const cases = [...block.matchAll(/\('([^']*)', (true|false)\)/g)].map((m) => [m[1], m[2] === "true"]);
  it("reads the server's case list", () => {
    assert.ok(cases.length >= 14, `found ${cases.length} cases`);
    assert.ok(cases.some(([, want]) => want) && cases.some(([, want]) => !want));
  });
  it("each case matches in the browser mirror", () => {
    for (const [email, want] of cases) assert.equal(isInternalEmail(email), want, email);
  });
});
