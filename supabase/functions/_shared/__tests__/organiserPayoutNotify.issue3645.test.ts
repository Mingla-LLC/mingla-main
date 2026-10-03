/**
 * Issue #3645 PR10 — organiserPayoutNotify behavioral regression.
 *
 * Covers released / terminal-failed / no-op status gating, per-recipient
 * idempotency keys, first-payout + bank milestones, and dispatch failure
 * leaving durable drains open.
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  drainOutcomeNotices,
  drainPausedNotices,
  fireBankAddedMilestone,
  notifyBrandManagers,
  notifyPaystackReleaseOutcome,
  type OrganiserNotifyDeps,
  type OrganiserNotifyInput,
} from "../organiserPayoutNotify.ts";

type ReleaseRow = {
  id: string;
  brand_id: string;
  status: string;
  currency: string | null;
  organiser_cash_delivered_cents: number | null;
  net_release_cents: number | null;
  provider?: string;
};

function makeSupabase(opts: {
  release?: ReleaseRow | null;
  releaseError?: { message: string } | null;
  pauseRows?: Array<Record<string, unknown>>;
  outcomeRows?: Array<Record<string, unknown>>;
  completePauseError?: { message: string } | null;
  completeOutcomeError?: { message: string } | null;
  /** When set, brand_team_members role lookup returns this error (strict path). */
  teamLookupError?: { message: string } | null;
  teamMembers?: Array<{ user_id: string; role: string }>;
}) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];

  const teamLookupTerminal = () =>
    Promise.resolve({
      data: opts.teamLookupError ? null : (opts.teamMembers ?? []),
      error: opts.teamLookupError ?? null,
    });

  // Chain matches getBrandTeamUserIdsByRolesOrThrow:
  // from().select().eq().is().not().in()
  const teamMembersQuery = {
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        is: (_col2: string, _val2: unknown) => ({
          not: (_col3: string, _op: string, _val3: unknown) => ({
            in: (_col4: string, _roles: unknown) => teamLookupTerminal(),
          }),
        }),
      }),
    }),
  };

  const releaseQuery = {
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        eq: (_col2: string, _val2: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: opts.release ?? null,
              error: opts.releaseError ?? null,
            }),
        }),
        maybeSingle: () =>
          Promise.resolve({
            data: opts.release ?? null,
            error: opts.releaseError ?? null,
          }),
      }),
    }),
  };

  const supabase = {
    from: (table: string) => {
      if (table === "brand_team_members") return teamMembersQuery;
      return releaseQuery;
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ name, args });
      if (name === "claim_brand_payout_pause_notices") {
        return Promise.resolve({ data: opts.pauseRows ?? [], error: null });
      }
      if (name === "complete_brand_payout_pause_notices") {
        return Promise.resolve({
          data: (args.p_notice_ids as string[] | undefined)?.length ?? 0,
          error: opts.completePauseError ?? null,
        });
      }
      if (name === "claim_brand_payout_outcome_notices") {
        return Promise.resolve({ data: opts.outcomeRows ?? [], error: null });
      }
      if (name === "complete_brand_payout_outcome_notices") {
        return Promise.resolve({
          data: (args.p_notice_ids as string[] | undefined)?.length ?? 0,
          error: opts.completeOutcomeError ?? null,
        });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } });
    },
  };
  return { supabase: supabase as never, rpcs };
}

function trackingDeps(opts?: {
  notifyThrow?: boolean;
  claimResults?: Record<string, boolean>;
}): {
  deps: OrganiserNotifyDeps;
  notifies: OrganiserNotifyInput[];
  milestones: string[];
  appsFlyer: Array<{ eventName: string; eventValues: Record<string, unknown> }>;
} {
  const notifies: OrganiserNotifyInput[] = [];
  const milestones: string[] = [];
  const appsFlyer: Array<
    { eventName: string; eventValues: Record<string, unknown> }
  > = [];
  const claimResults = opts?.claimResults ?? {};
  const deps: OrganiserNotifyDeps = {
    notifyBrandManagers: async (_sb, input) => {
      if (opts?.notifyThrow) throw new Error("dispatch_failed");
      notifies.push(input);
    },
    claimMilestone: async (_sb, _brandId, column) => {
      milestones.push(column);
      return claimResults[column] ?? true;
    },
    resolveOwnerUserId: async () => "owner-1",
    postAppsFlyer: async (input) => {
      appsFlyer.push({
        eventName: input.eventName,
        eventValues: input.eventValues as Record<string, unknown>,
      });
      return true;
    },
  };
  return { deps, notifies, milestones, appsFlyer };
}

Deno.test("#3645 organiser notify: released → payout_paid + first-payout milestone", async () => {
  const { supabase } = makeSupabase({
    release: {
      id: "rel-paid",
      brand_id: "brand-1",
      status: "released",
      currency: "ngn",
      organiser_cash_delivered_cents: 4500,
      net_release_cents: 4500,
    },
  });
  const { deps, notifies, milestones, appsFlyer } = trackingDeps();
  const outcome = await notifyPaystackReleaseOutcome(supabase, "rel-paid", deps);
  assertEquals(outcome, "paid");
  assertEquals(notifies.length, 1);
  assertEquals(notifies[0].type, "business.payout_paid");
  assertEquals(notifies[0].idempotencyKey, "business.payout_paid:paystack:rel-paid");
  assertEquals(notifies[0].roles, ["brand_owner", "finance_manager"]);
  assertEquals(milestones, ["first_payout_at"]);
  assertEquals(appsFlyer[0]?.eventName, "mingla_first_payout");
});

Deno.test("#3645 organiser notify: terminal failed → payout_failed (no analytics)", async () => {
  const { supabase } = makeSupabase({
    release: {
      id: "rel-fail",
      brand_id: "brand-1",
      status: "failed",
      currency: "ngn",
      organiser_cash_delivered_cents: 0,
      net_release_cents: 2000,
    },
  });
  const { deps, notifies, milestones, appsFlyer } = trackingDeps();
  const outcome = await notifyPaystackReleaseOutcome(supabase, "rel-fail", deps);
  assertEquals(outcome, "failed");
  assertEquals(notifies.length, 1);
  assertEquals(notifies[0].type, "business.payout_failed");
  assertEquals(
    notifies[0].idempotencyKey,
    "business.payout_failed:paystack:rel-fail",
  );
  assertEquals(milestones, []);
  assertEquals(appsFlyer, []);
});

Deno.test("#3645 organiser notify: non-terminal status is a no-op", async () => {
  for (const status of ["pending", "in_flight", "blocked_balance"]) {
    const { supabase } = makeSupabase({
      release: {
        id: "rel-mid",
        brand_id: "brand-1",
        status,
        currency: "ngn",
        organiser_cash_delivered_cents: 0,
        net_release_cents: 1000,
      },
    });
    const { deps, notifies } = trackingDeps();
    assertEquals(
      await notifyPaystackReleaseOutcome(supabase, "rel-mid", deps),
      "none",
    );
    assertEquals(notifies, []);
  }
});

Deno.test("#3645 organiser notify: missing release is a no-op", async () => {
  const { supabase } = makeSupabase({ release: null });
  const { deps, notifies } = trackingDeps();
  assertEquals(
    await notifyPaystackReleaseOutcome(supabase, "missing", deps),
    "none",
  );
  assertEquals(notifies, []);
});

Deno.test("#3645 organiser notify: lookup error throws (no swallow)", async () => {
  const { supabase } = makeSupabase({
    releaseError: { message: "db down" },
  });
  const { deps } = trackingDeps();
  await assertRejects(
    () => notifyPaystackReleaseOutcome(supabase, "rel-x", deps),
    Error,
    "organiser release outcome lookup failed",
  );
});

Deno.test("#3645 organiser notify: bank-added milestone fires once", async () => {
  const { supabase } = makeSupabase({});
  const first = trackingDeps({ claimResults: { first_bank_added_at: true } });
  assertEquals(
    await fireBankAddedMilestone(
      supabase,
      "brand-1",
      "paystack_subaccount",
      first.deps,
    ),
    true,
  );
  assertEquals(first.appsFlyer[0]?.eventName, "mingla_bank_added");

  const second = trackingDeps({ claimResults: { first_bank_added_at: false } });
  assertEquals(
    await fireBankAddedMilestone(
      supabase,
      "brand-1",
      "paystack_recipient",
      second.deps,
    ),
    false,
  );
  assertEquals(second.appsFlyer, []);
});

Deno.test("#3645 organiser notify: pause drain delivers then completes", async () => {
  const { supabase, rpcs } = makeSupabase({
    pauseRows: [{
      notice_id: "n-pause",
      brand_id: "brand-1",
      kind: "paused",
      brand_name: "Acme",
    }],
  });
  const { deps, notifies } = trackingDeps();
  const result = await drainPausedNotices(supabase, deps);
  assertEquals(result, { listed: 1, delivered: 1 });
  assertEquals(notifies[0].type, "business.payouts_paused");
  assertEquals(notifies[0].idempotencyKey, "business.payouts_paused:n-pause");
  assertEquals(
    rpcs.some((r) =>
      r.name === "complete_brand_payout_pause_notices" &&
      (r.args.p_notice_ids as string[])[0] === "n-pause"
    ),
    true,
  );
});

Deno.test("#3645 organiser notify: pause dispatch failure leaves notice open", async () => {
  const { supabase, rpcs } = makeSupabase({
    pauseRows: [{
      notice_id: "n-open",
      brand_id: "brand-1",
      kind: "resumed",
      brand_name: "Acme",
    }],
  });
  const { deps } = trackingDeps({ notifyThrow: true });
  const result = await drainPausedNotices(supabase, deps);
  assertEquals(result, { listed: 1, delivered: 0 });
  assertEquals(
    rpcs.some((r) => r.name === "complete_brand_payout_pause_notices"),
    false,
  );
});

Deno.test(
  "#3645 organiser notify: recipient lookup error leaves pause notice open",
  async () => {
    const { supabase, rpcs } = makeSupabase({
      pauseRows: [{
        notice_id: "n-lookup-err",
        brand_id: "brand-1",
        kind: "paused",
        brand_name: "Acme",
      }],
      teamLookupError: { message: "connection reset" },
    });
    // Real notifyBrandManagers (strict OrThrow) — not the tracking stub.
    const result = await drainPausedNotices(supabase, {
      ...trackingDeps().deps,
      notifyBrandManagers,
    });
    assertEquals(result, { listed: 1, delivered: 0 });
    assertEquals(
      rpcs.some((r) => r.name === "complete_brand_payout_pause_notices"),
      false,
    );
  },
);

Deno.test(
  "#3645 organiser notify: recipient lookup error leaves outcome notice open",
  async () => {
    const { supabase, rpcs } = makeSupabase({
      release: {
        id: "rel-lookup",
        brand_id: "brand-1",
        status: "released",
        currency: "ngn",
        organiser_cash_delivered_cents: 900,
        net_release_cents: 900,
      },
      outcomeRows: [{
        notice_id: "n-out-lookup",
        release_id: "rel-lookup",
        brand_id: "brand-1",
        kind: "paid",
      }],
      teamLookupError: { message: "connection reset" },
    });
    const result = await drainOutcomeNotices(supabase, {
      ...trackingDeps().deps,
      notifyBrandManagers,
    });
    assertEquals(result, { listed: 1, delivered: 0 });
    assertEquals(
      rpcs.some((r) => r.name === "complete_brand_payout_outcome_notices"),
      false,
    );
  },
);

Deno.test(
  "#3645 organiser notify: notifyBrandManagers throws on team lookup error",
  async () => {
    const { supabase } = makeSupabase({
      teamLookupError: { message: "db down" },
    });
    await assertRejects(
      () =>
        notifyBrandManagers(supabase, {
          brandId: "brand-1",
          type: "business.payouts_paused",
          title: "Payouts paused",
          body: "paused",
          idempotencyKey: "k",
        }),
      Error,
      "brand team-by-roles lookup failed",
    );
  },
);

Deno.test("#3645 organiser notify: outcome drain dispatches then completes", async () => {
  const release: ReleaseRow = {
    id: "rel-out",
    brand_id: "brand-1",
    status: "released",
    currency: "ngn",
    organiser_cash_delivered_cents: 1200,
    net_release_cents: 1200,
  };
  const { supabase, rpcs } = makeSupabase({
    release,
    outcomeRows: [{
      notice_id: "n-out",
      release_id: "rel-out",
      brand_id: "brand-1",
      kind: "paid",
    }],
  });
  const { deps, notifies } = trackingDeps();
  const result = await drainOutcomeNotices(supabase, deps);
  assertEquals(result, { listed: 1, delivered: 1 });
  assertEquals(notifies[0].type, "business.payout_paid");
  assertEquals(
    rpcs.some((r) =>
      r.name === "complete_brand_payout_outcome_notices" &&
      (r.args.p_notice_ids as string[])[0] === "n-out"
    ),
    true,
  );
});

Deno.test("#3645 organiser notify: outcome dispatch failure leaves notice open", async () => {
  const { supabase, rpcs } = makeSupabase({
    release: {
      id: "rel-out",
      brand_id: "brand-1",
      status: "failed",
      currency: "ngn",
      organiser_cash_delivered_cents: 0,
      net_release_cents: 500,
    },
    outcomeRows: [{
      notice_id: "n-fail",
      release_id: "rel-out",
      brand_id: "brand-1",
      kind: "failed",
    }],
  });
  const { deps } = trackingDeps({ notifyThrow: true });
  const result = await drainOutcomeNotices(supabase, deps);
  assertEquals(result, { listed: 1, delivered: 0 });
  assertEquals(
    rpcs.some((r) => r.name === "complete_brand_payout_outcome_notices"),
    false,
  );
});
