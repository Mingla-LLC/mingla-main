// Issue #4422 — the REAL rsvp-notify worker parks a held Nigerian text until
// 08:00 WAT instead of burning its retry ladder, and raises one ops alert for
// a guest reached on no channel.
//
// MINGLA-INVARIANT: I-4422-UNREACHED-GUEST-ALERTED-ONCE | issue #4422 | A guest with no reached channel and nothing still owed produces exactly one ops alert email to the existing API_HEALTH_ALERT_EMAILS recipients, holding ids and safe codes only, never a contact; a second tick sends nothing.
//
// Runs the actual handler (std serve() driven in memory by _stdServeHarness,
// so the CI lane needs no import map), the real dispatcher and the real SMS
// adapter. Only the network and Deno.env are
// replaced: every request goes to an in-memory fixture, and any request it
// does not recognise fails the test.
//
// fails-on-revert:
//   - rsvp-notify's `deferred` branch removed  -> T-1 sees finish, not defer
//   - notifyV2 back to `retryable`             -> T-1 sees failed_retryable
//   - the tick's alert call removed            -> T-3 sees no alert email
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>
import {
  importWithStdServe,
  invokeStdServe,
} from "../../_shared/__tests__/_stdServeHarness.ts";
import { __setNgEmbargoClock } from "../../_shared/ngSmsEmbargo.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};
const same = (actual: unknown, expected: unknown, message: string): void =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${
      JSON.stringify(actual)
    }`,
  );

const ORIGIN = "https://fixture.invalid";
const TERMII = "https://termii.fixture.invalid";
const RSVP_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const GUEST_PHONE = "+2348030000001";
const GUEST_EMAIL = "guest-4422@example.invalid";

const fixtureEnv: Record<string, string> = {
  SUPABASE_URL: ORIGIN,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only",
  RESEND_API_KEY: "fixture-resend-only",
  DENO_TESTING: "1",
  "app.qr_token_pepper": "fixture-pepper-4422-not-a-real-secret-123456789",
  SMS_LIVE_ENABLED_NG: "true",
  TERMII_API_KEY: "fixture-only",
  TERMII_BASE_URL: TERMII,
  TERMII_SENDER_ID: "Mingla",
  API_HEALTH_ALERT_EMAILS: "ops-a@example.invalid,ops-b@example.invalid",
};

interface Seen {
  rpc: Array<{ name: string; body: Record<string, unknown> }>;
  sms: string[];
  emails: Array<Record<string, unknown>>;
  rejected: string[];
}

interface Scenario {
  claims: unknown[];
  unreached: unknown[];
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

function smsClaim(): Record<string, unknown> {
  return {
    delivery_id: "fixture-delivery",
    notification_id: "fixture-notification",
    channel: "sms",
    attempt_count: 1,
    lease_id: "fixture-lease",
    template_key: "rsvp_pass",
    idempotency_key: "fixture-key",
    payload: {
      rsvpId: RSVP_ID,
      entityId: RSVP_ID,
      role: "primary",
      recipientPhone: GUEST_PHONE,
      eventName: "Lagos Rooftop",
      brandName: "Fixture host",
      recipientName: "Ada",
      qrCode: "fixture-qr",
    },
  };
}

function install(scenario: () => Scenario, seen: Seen): () => void {
  const previousFetch = globalThis.fetch;
  const previousGet = Deno.env.get;
  Deno.env.get = (name: string) => fixtureEnv[name];
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const s = scenario();
    if (url.origin === ORIGIN) {
      const leaf = url.pathname.split("/").at(-1) ?? "";
      const body = req.method === "GET" ? {} : await req.json();
      if (url.pathname.includes("/rpc/")) {
        seen.rpc.push({ name: leaf, body });
        if (leaf === "claim_rsvp_notification_deliveries") {
          return json(s.claims);
        }
        if (leaf === "issue_4422_claim_unreached_guest_alerts") {
          return json(s.unreached);
        }
        if (leaf === "event_edit_notice_fanout") return json({ rows: 0 });
        return json(true);
      }
      if (leaf === "notification_categories") {
        return json({
          key: "rsvp_pass",
          active: true,
          default_channels: ["inapp", "push", "email", "sms"],
        });
      }
      if (leaf === "events") {
        return json({
          status: "scheduled",
          visibility: "public",
          deleted_at: null,
          event_type: "rsvp",
          brands: { deleted_at: null, contact_email: null },
        });
      }
      if (leaf === "event_rsvps") {
        if (req.method === "PATCH") return json(null);
        return json({
          event_id: EVENT_ID,
          rsvp_status: "going",
          approval_status: "approved",
          pass_recovery_token_hash: null,
          pass_recovery_token_created_at: "2026-11-11T21:00:00.000Z",
        });
      }
    }
    if (url.href === `${TERMII}/api/sms/send`) {
      const body = await req.json() as { sms: string };
      seen.sms.push(body.sms);
      return json({ message_id: "3017857812138224517130997", code: "ok" });
    }
    if (url.href === "https://api.resend.com/emails") {
      seen.emails.push(await req.json());
      return json({ id: "fixture-email" });
    }
    seen.rejected.push(`${req.method} ${url.origin}${url.pathname}`);
    throw new Error("Unexpected external request blocked");
  };
  return () => {
    globalThis.fetch = previousFetch;
    Deno.env.get = previousGet;
  };
}

async function tick(seen: Seen, body = "{}"): Promise<void> {
  seen.rpc.length = 0;
  seen.sms.length = 0;
  seen.emails.length = 0;
  const response = await invokeStdServe(
    new Request("http://localhost/rsvp-notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-service-only",
        "Content-Type": "application/json",
      },
      body,
    }),
  );
  assert(response.status === 200, `worker answered ${response.status}`);
  await response.body?.cancel();
  same(seen.rejected, [], "no unrecognised outbound request");
}

let loaded = false;
async function loadWorker(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await importWithStdServe(new URL("../index.ts", import.meta.url).href);
}

const scenarioRef: { current: Scenario } = {
  current: { claims: [], unreached: [] },
};
const seen: Seen = { rpc: [], sms: [], emails: [], rejected: [] };

Deno.test({
  name:
    "T-1/T-2 a text claimed at 23:00 WAT is deferred to 08:00 WAT; at 08:01 it is sent",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const restore = install(() => scenarioRef.current, seen);
    try {
      await loadWorker();
      scenarioRef.current = { claims: [smsClaim()], unreached: [] };

      // 23:00 WAT, 11 Nov.
      __setNgEmbargoClock(() => new Date("2026-11-11T22:00:00.000Z"));
      await tick(
        seen,
        JSON.stringify({ notificationId: "fixture-notification" }),
      );
      const defer = seen.rpc.filter((r) =>
        r.name === "defer_rsvp_notification_delivery"
      );
      same(defer.length, 1, "one defer call");
      same(defer[0].body, {
        p_delivery_id: "fixture-delivery",
        p_lease_id: "fixture-lease",
        p_safe_error_code: "ng_operator_embargo",
        p_next_attempt_at: "2026-11-12T07:00:00.000Z",
      }, "defer carries the 08:00 WAT reopen instant");
      same(
        seen.rpc.filter((r) => r.name === "finish_rsvp_notification_delivery")
          .length,
        0,
        "a held text is never finished (no retry ladder)",
      );
      same(
        seen.sms.length,
        0,
        "nothing reaches the provider inside the embargo",
      );
      same(
        seen.rpc.some((r) =>
          r.name === "issue_4422_claim_unreached_guest_alerts"
        ),
        false,
        "a single-notification call never runs the alert",
      );

      // 08:01 WAT, 12 Nov.
      __setNgEmbargoClock(() => new Date("2026-11-12T07:01:00.000Z"));
      await tick(
        seen,
        JSON.stringify({ notificationId: "fixture-notification" }),
      );
      const finish = seen.rpc.filter((r) =>
        r.name === "finish_rsvp_notification_delivery"
      );
      same(finish.length, 1, "one finish once the window is open");
      same(finish[0].body.p_status, "sent", "the held text is sent");
      same(seen.sms.length, 1, "one provider send");
      same(
        seen.rpc.some((r) => r.name === "defer_rsvp_notification_delivery"),
        false,
        "no defer once the window is open",
      );
    } finally {
      __setNgEmbargoClock(null);
      restore();
    }
  },
});

Deno.test({
  name:
    "T-3 an unreached guest raises one alert with ids and codes only; the next tick sends nothing",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const restore = install(() => scenarioRef.current, seen);
    try {
      await loadWorker();
      scenarioRef.current = {
        claims: [],
        unreached: [{
          subject_id: "830dcd72-0000-4000-8000-000000000001",
          event_id: EVENT_ID,
          codes: "email_bounced_permanent,ng_operator_embargo",
        }],
      };
      await tick(seen);
      const claim = seen.rpc.filter((r) =>
        r.name === "issue_4422_claim_unreached_guest_alerts"
      );
      same(claim.length, 1, "the tick claims once");
      same(
        claim[0].body,
        { p_source: "rsvp", p_limit: 50 },
        "claims the rsvp source",
      );
      same(seen.emails.length, 2, "one alert email per configured recipient");
      const recipients = seen.emails.map((e) => (e.to as string[])[0]).sort();
      same(
        recipients,
        ["ops-a@example.invalid", "ops-b@example.invalid"],
        "sent to the existing API_HEALTH_ALERT_EMAILS recipients",
      );
      const email = seen.emails[0];
      same(
        email.subject,
        "RSVP guests not reached (1)",
        "subject names the count",
      );
      const content = `${email.text}\n${email.html}`;
      assert(content.includes("830dcd72"), "the id prefix is in the alert");
      assert(content.includes(EVENT_ID), "the event id is in the alert");
      assert(
        content.includes("email_bounced_permanent,ng_operator_embargo"),
        "the codes are in the alert",
      );
      assert(
        !content.includes(GUEST_PHONE) && !content.includes(GUEST_EMAIL) &&
          !content.includes("8030000001"),
        "the alert never carries a contact",
      );

      scenarioRef.current = { claims: [], unreached: [] };
      await tick(seen);
      same(
        seen.emails.length,
        0,
        "a second tick (ledger already holds the guest) sends nothing",
      );
    } finally {
      restore();
    }
  },
});
