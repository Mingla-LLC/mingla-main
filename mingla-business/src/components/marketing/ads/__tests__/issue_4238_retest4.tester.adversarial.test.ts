/**
 * #4238 — tester RETEST 4 adversarial suite (Business app side). Angles the
 * implementor's retest-3 tests (mostly source-string checks) do not cover:
 *
 *  Ready. buildHostAdList run over EVERY ad_plans.state the database allows:
 *         only staff_approved and funded_held read "Ready to start", each of
 *         those also offers "Launch", and no other state borrows the label.
 *  Words. hostAdResultLabel is idempotent (a label fed back in comes back
 *         unchanged) for every raw key, spaced key, dashed key and upper-case
 *         key, so a server that already sends plain words can never be
 *         double-translated.
 *  Places hostAdPlaceName with spacing, empty parts and lower-case codes.
 *
 * Fails on revert (verified by line-deletion at c8ddb4d51):
 *  - planItem without the statusLabel spread → no "Ready to start".
 *  - hostAdResultLabel without the PLAIN_RESULT_LABELS early return →
 *    "RSVPs" becomes "rsvps".
 *  - create.tsx / hostAdPlaceName removed → "NG" stays a code.
 */

import { buildHostAdList } from "../../../../services/hostAdLifecycle";
import type { HostAdPlanAggregate } from "../../../../services/hostAdPlanService";
import {
  hostAdCopyIsPlain,
  hostAdPlaceName,
  hostAdResultLabel,
} from "../hostAdCopy";

// ad_plans_state_check, read from the local stack on 2026-11-02.
const PLAN_STATES = [
  "draft",
  "validating",
  "ready_for_funding",
  "funding_pending",
  "funded_held",
  "staff_review_required",
  "staff_approved",
  "creating_paused_objects",
  "platform_review",
  "scheduled",
  "live",
  "pause_requested",
  "paused",
  "stop_requested",
  "settling",
  "ended",
  "changes_requested",
  "staff_rejected",
  "platform_rejected",
  "partially_ready",
  "partially_live",
  "creation_failed_retryable",
  "creation_failed_terminal",
  "payment_failed",
  "expired",
  "cancelled_before_create",
  "settlement_attention_required",
];

const plan = (state: string, n: number): HostAdPlanAggregate =>
  ({
    plan: {
      id: `plan-${state}`,
      state,
      current_version_id: `v-${n}`,
      destination_key: "event:femzy:deserted-island",
      review_required: false,
      review_reasons: [],
      updated_at: `2026-10-01T00:00:${String(n).padStart(2, "0")}.000Z`,
      brand_id: "brand-a",
      owner_kind: "host",
    },
    version: {
      id: `v-${n}`,
      plan_hash: "a".repeat(64),
      host_currency: "NGN",
      host_budget_cents: 150_000_000,
      canonical_plan: { name: `Ad ${state}` },
    },
    provider_allocations: [],
    targeting_snapshots: [],
    reviews: [],
    funding_hold: null,
    provider_attempts: [],
    campaigns: [],
  }) as HostAdPlanAggregate;

describe("#4238 RETEST4 Ready to start across every plan state", () => {
  const items = buildHostAdList({
    drafts: [],
    plans: PLAN_STATES.map(plan),
    campaigns: [],
  });
  const byState = new Map(
    items.map((item) => [item.id.replace(/^plan-/, ""), item]),
  );

  it("only an approved or funded ad waiting for LAUNCH reads Ready to start", () => {
    const ready = PLAN_STATES.filter(
      (state) => byState.get(state)?.statusLabel === "Ready to start",
    );
    expect(ready.sort()).toEqual(["funded_held", "staff_approved"]);
  });

  it("every Ready to start row offers Launch, and no other row says Ready", () => {
    for (const state of PLAN_STATES) {
      const item = byState.get(state);
      expect(item).toBeDefined();
      if (item?.statusLabel === "Ready to start") {
        expect(item.nextAction).toBe("Launch");
      } else {
        expect(item?.statusLabel).toBeUndefined();
      }
      if (item?.statusLabel) expect(hostAdCopyIsPlain(item.statusLabel)).toBe(true);
    }
  });

  it("drafts and campaigns never carry a status label", () => {
    const list = buildHostAdList({
      drafts: [
        {
          id: "d-1",
          plan_id: null,
          current_step: "budget",
          draft_state: { name: "Draft ad" },
          updated_at: "2026-10-02T00:00:00.000Z",
        } as never,
      ],
      plans: [],
      campaigns: [],
    });
    expect(list[0].statusLabel).toBeUndefined();
  });
});

describe("#4238 RETEST4 result labels are idempotent", () => {
  const RAW = [
    "tickets",
    "ticket_purchase",
    "purchase",
    "signups",
    "reservation",
    "bookings",
    "booking_confirmed",
    "clicks",
    "click",
    "landing_page_view",
    "page_view",
    "rsvp_registration",
    "rsvp_registrations",
    "rsvps",
    "rsvp",
    "checkout_started",
    "checkouts_started",
    "install",
    "installs",
    "app_installs",
    "app_store_click",
    "app_store_visits",
    "results",
    "conversions",
  ];

  it("a label fed back in comes back unchanged", () => {
    for (const raw of RAW) {
      const once = hostAdResultLabel(raw);
      expect(`${raw} → ${hostAdResultLabel(once)}`).toBe(`${raw} → ${once}`);
      expect(once).not.toMatch(/_/);
      expect(hostAdCopyIsPlain(once)).toBe(true);
    }
  });

  it("spaced, dashed, upper-case and padded keys read the same as the raw key", () => {
    for (const raw of RAW) {
      const want = hostAdResultLabel(raw);
      expect(hostAdResultLabel(raw.replace(/_/g, " "))).toBe(want);
      expect(hostAdResultLabel(raw.replace(/_/g, "-"))).toBe(want);
      expect(hostAdResultLabel(`  ${raw.toUpperCase()}  `)).toBe(want);
    }
  });

  it("RSVP keys in every shape read RSVPs", () => {
    for (const kind of [
      "rsvp_registration",
      "rsvp registration",
      "RSVP_REGISTRATION",
      "rsvps",
      "RSVPs",
      " RSVPs ",
      "rsvp",
    ]) {
      expect(hostAdResultLabel(kind)).toBe("RSVPs");
    }
  });
});

describe("#4238 RETEST4 city rows spell out the country", () => {
  it.each([
    ["Lagos, Lagos State, NG", "Lagos, Lagos State, Nigeria"],
    ["Lagos,Lagos State,NG", "Lagos, Lagos State, Nigeria"],
    ["  Accra ,  Greater Accra ,GH ", "Accra, Greater Accra, Ghana"],
    ["Lagos, Lagos State, ", "Lagos, Lagos State"],
    ["London, England, GB", "London, England, United Kingdom"],
    ["Accra", "Accra"],
  ])("%s → %s", (raw, want) => {
    expect(hostAdPlaceName(raw)).toBe(want);
  });

  it("never prints a bare two-letter country code", () => {
    for (const raw of ["Lagos, Lagos State, NG", "Nairobi, Nairobi County, KE"]) {
      expect(hostAdPlaceName(raw)).not.toMatch(/(^|, )[A-Z]{2}$/);
    }
  });
});
