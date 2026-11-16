// #4452 A1.5 (A1-T-4 … A1-T-8; A1-SC-20 … A1-SC-27): emailing leads through the
// MINGLA-INVARIANT: I-4452-LEADS-EMAIL-CONSENT | issue #4452 | a Leads list send reaches only marketing_consent 'yes' people; a reply is blocked only by a full ('all') opt-out.
// existing composer. The real createCampaign / model / audience over a
// scripted in-memory client: the selection resolver, suppressions, the
// campaign log, deliveries and the audit row.
//
// FAILS-ON-REVERT: making "leads" not require consent fails A1-T-5; letting a
// marketing-only unsubscribe block a reply fails A1-T-6; dropping the
// leads_can_view gate fails A1-T-7; dropping the 5-a-day limit fails A1-T-8;
// storing the raw filter fails the audit case.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_URL", "https://project.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
Deno.env.set("RESEND_API_KEY", "re_test_issue_4452");
Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-4452-unsubscribe-secret-long-enough-for-tests");
const { createCampaign, errorStatus } = await import("./index.ts");
const { normalizeAudience } = await import("./model.ts");
const { leadRowToRecipient, leadsAuditAudience, leadsLimitError, requiresMarketingConsent, LEADS_MAX_RECIPIENTS } = await import("./audience.ts");

const SEL = "44520000-0000-4000-8000-0000000000a1";
const LEAD = "44520000-0000-4000-8000-0000000000b1";
const ACTOR = "44520000-0000-4000-8000-0000000000c1";

type Resolved = { lead_id: string; email: string; display_name: string; first_name: string; marketing_consent: string; is_internal: boolean };
const LEADS: Resolved[] = [
  { lead_id: "l1", email: "ada@example.org", display_name: "Ada Okafor", first_name: "Ada", marketing_consent: "yes", is_internal: false },
  { lead_id: "l2", email: "bola@example.org", display_name: "Bola", first_name: "Bola", marketing_consent: "no", is_internal: false },
  { lead_id: "l3", email: "cy@example.org", display_name: "Cy", first_name: "Cy", marketing_consent: "unsubscribed", is_internal: false },
  { lead_id: "l4", email: "staff@usemingla.com", display_name: "Staff", first_name: "Staff", marketing_consent: "yes", is_internal: true },
  { lead_id: "l5", email: "ADA@example.org", display_name: "Ada again", first_name: "Ada", marketing_consent: "yes", is_internal: false },
];

function world(opts: { canView?: boolean; recent?: number; suppressions?: Array<{ contact: string; scope: string }>; lead?: Record<string, unknown>; resolved?: Resolved[] } = {}) {
  const inserted: Record<string, unknown[]> = {};
  const rpcCalls: Array<[string, unknown]> = [];
  const filters: Array<[string, unknown]> = [];
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    let scopes: string[] = [];
    let head = false;
    const chain = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return chain; },
      eq: (k: string, v: unknown) => { filters.push([`${name}.${k}`, v]); return chain; },
      in: (k: string, v: string[]) => { if (k === "scope") scopes = v; return chain; },
      not: () => chain,
      gte: () => chain,
      maybeSingle: () => Promise.resolve({ data: name === "lead_audience_selections" ? { filter: { q: "ada okafor", labels: ["creator"] } } : null, error: null }),
      insert: (rows: unknown) => {
        (inserted[name] ??= []).push(...(Array.isArray(rows) ? rows : [rows]));
        return { ...chain, then: (r: (v: unknown) => unknown) => r({ error: null }) , select: () => ({ single: () => Promise.resolve({ data: { id: "camp-1", status: "scheduled", scheduled_for: null, recipient_count: 0, skipped_count: 0 }, error: null }) }) };
      },
      update: () => chain,
      then: (resolve: (v: unknown) => unknown) => {
        if (name === "channel_suppressions") {
          return resolve({ data: (opts.suppressions ?? []).filter((s) => scopes.includes(s.scope)), error: null });
        }
        if (name === "admin_email_log" && head) return resolve({ count: opts.recent ?? 0, error: null });
        return resolve({ data: [], error: null });
      },
    };
    void q;
    return chain;
  };
  const service = {
    from: table,
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push([fn, args]);
      if (fn === "leads_audience_resolve") return Promise.resolve({ data: opts.resolved ?? LEADS, error: null });
      return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
    },
  };
  const caller = {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push([`caller:${fn}`, args]);
      if (fn === "leads_can_view") return Promise.resolve({ data: opts.canView ?? true, error: null });
      if (fn === "admin_lead_get") return Promise.resolve({ data: { lead: opts.lead ?? { id: LEAD, email: "bola@example.org", name: "Bola Ade", marketing_consent: false } }, error: null });
      return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
    },
  };
  return { service, caller, inserted, rpcCalls, filters };
}

const future = new Date(Date.now() + 3_600_000).toISOString();
const doc = [{ id: "b1", type: "rich_text", html: "<p>Hi {first_name}</p>" }];
const send = (w: ReturnType<typeof world>, audience: Record<string, unknown>) =>
  createCampaign(w.service as never, ACTOR, { subject: "News", document: doc, audience, scheduledFor: future, timezone: "UTC" },
    { actorId: ACTOR, caller: w.caller as never, actorEmail: "staff@usemingla.com" });

Deno.test("A1-T-4 normalizeAudience accepts the two leads modes and nothing loose", () => {
  assertEquals(normalizeAudience({ mode: "leads", selectionId: SEL.toUpperCase() }), { mode: "leads", selectionId: SEL });
  assertEquals(normalizeAudience({ mode: "lead_reply", leadId: LEAD }), { mode: "lead_reply", leadId: LEAD });
  for (const bad of [{ mode: "leads" }, { mode: "leads", selectionId: "x" }, { mode: "lead_reply", leadId: "../" }]) {
    let threw = false;
    try { normalizeAudience(bad); } catch { threw = true; }
    assert(threw, JSON.stringify(bad));
  }
});

Deno.test("A1-T-5 A1-SC-22 a Leads send reaches only consent 'yes'; staff, duplicates and unsubscribed are counted out", async () => {
  const w = world();
  const c = await send(w, { mode: "leads", selectionId: SEL });
  assertEquals(c.will_receive, 1, "only Ada");
  assertEquals([c.no_consent, c.skipped_opt_out, c.internal, c.duplicate], [1, 1, 1, 1]);
  const deliveries = (w.inserted["admin_email_recipient_deliveries"] ?? []) as Array<{ recipient_email: string; status: string }>;
  assertEquals(deliveries.filter((d) => d.status === "pending").map((d) => d.recipient_email), ["ada@example.org"]);
  assertEquals(w.rpcCalls.find(([f]) => f === "leads_audience_resolve")?.[1], { p_selection_id: SEL, p_actor: ACTOR });
  assertEquals(requiresMarketingConsent({ mode: "leads" }, leadRowToRecipient({ email: "x@y.z", marketing_consent: "yes" })), true);
  assertEquals(requiresMarketingConsent({ mode: "lead_reply" }, leadRowToRecipient({ email: "x@y.z" })), false);
});

Deno.test("A1-T-6 A1-SC-24 a reply ignores consent and a marketing-only unsubscribe, but a full opt-out blocks it (422)", async () => {
  const ok = world({ suppressions: [{ contact: "bola@example.org", scope: "marketing" }] });
  const c = await send(ok, { mode: "lead_reply", leadId: LEAD });
  assertEquals(c.will_receive, 1);
  const log = (ok.inserted["admin_email_log"] ?? [])[0] as Record<string, unknown>;
  assertEquals(log.recipient_type, "individual");
  assertEquals(log.recipient_email, "bola@example.org");
  assertEquals(log.audience, { mode: "lead_reply", leadId: LEAD });
  const blocked = world({ suppressions: [{ contact: "bola@example.org", scope: "all" }] });
  const err = await assertRejects(() => send(blocked, { mode: "lead_reply", leadId: LEAD }));
  assertEquals((err as Error).message, "lead_reply_blocked");
  assertEquals(errorStatus(err), 422);
});

Deno.test("A1-T-7 A1-SC-25 both modes need leads_can_view as the caller (403); nothing is resolved without it", async () => {
  for (const audience of [{ mode: "leads", selectionId: SEL }, { mode: "lead_reply", leadId: LEAD }]) {
    const w = world({ canView: false });
    const err = await assertRejects(() => send(w, audience));
    assertEquals(errorStatus(err), 403);
    assertEquals(w.rpcCalls.some(([f]) => f === "leads_audience_resolve" || f === "caller:admin_lead_get"), false);
  }
  const err = await assertRejects(() => createCampaign(world().service as never, ACTOR, { subject: "x", document: doc, audience: { mode: "leads", selectionId: SEL } }));
  assertEquals(errorStatus(err), 403, "no caller context is never treated as allowed");
});

Deno.test("A1-T-8 A1-SC-26 limits: > 5,000 recipients (400), the 6th leads send in 24 h (429), the 61st reply in an hour (429)", async () => {
  assertEquals(leadsLimitError({ mode: "leads" }, { willReceive: LEADS_MAX_RECIPIENTS + 1, recentSends: 0 }), "leads_audience_too_large");
  assertEquals(leadsLimitError({ mode: "leads" }, { willReceive: LEADS_MAX_RECIPIENTS, recentSends: 4 }), null);
  assertEquals(leadsLimitError({ mode: "lead_reply" }, { willReceive: 1, recentSends: 59 }), null);
  const w = world({ recent: 5 });
  const err = await assertRejects(() => send(w, { mode: "leads", selectionId: SEL }));
  assertEquals((err as Error).message, "leads_send_limit");
  assertEquals(errorStatus(err), 429);
  assert(w.filters.some(([k, v]) => k === "admin_email_log.audience->>mode" && v === "leads"), "counts only this actor's leads sends");
  assert(w.filters.some(([k, v]) => k === "admin_email_log.sent_by" && v === ACTOR));
  const r = await assertRejects(() => send(world({ recent: 60 }), { mode: "lead_reply", leadId: LEAD }));
  assertEquals([(r as Error).message, errorStatus(r)], ["lead_reply_limit", 429]);
  assertEquals(errorStatus(new Error("leads_audience_too_large")), 400);
});

Deno.test("A1-SC-27 the log stores the selection with the search redacted; one audit row carries counts, no emails", async () => {
  const w = world();
  await send(w, { mode: "leads", selectionId: SEL });
  const log = (w.inserted["admin_email_log"] ?? [])[0] as Record<string, unknown>;
  assertEquals(log.audience, { mode: "leads", selectionId: SEL, filter: { q: "[search]", labels: ["creator"] }, selected: 5 });
  assertEquals(log.recipient_type, "bulk");
  const audit = (w.inserted["admin_audit_log"] ?? []) as Array<Record<string, unknown>>;
  assertEquals(audit.length, 1);
  assertEquals(audit[0].action, "email_campaign_leads_audience");
  const meta = audit[0].metadata as Record<string, unknown>;
  assertEquals([meta.selection_id, meta.selected, meta.will_receive, meta.no_consent, meta.opted_out, meta.internal, meta.duplicate], [SEL, 5, 1, 1, 1, 1, 1]);
  assert(!JSON.stringify(audit).includes("@example.org"), "no emails in the audit row");
  assertEquals(leadsAuditAudience({ mode: "lead_reply", leadId: LEAD }, null, 1), { mode: "lead_reply", leadId: LEAD });
});
