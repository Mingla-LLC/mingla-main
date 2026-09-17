// Unlisted RSVP invite link (#3443) — the REAL rsvp-notify worker, end to end.
//
// Runs the actual handler (serve() captured by the import-map shim), the real
// Supabase client, the real unified dispatcher, the real email/SMS adapters and
// the real pass PDF builder. Only the network is replaced: every request goes
// to an in-memory fixture, and any request the fixture does not recognise
// fails the test. No real provider, database or secret is touched.
//
// What it proves, per visibility x role x channel:
//   - public and unlisted ("hidden") RSVPs: an approved, going guest gets the
//     pass with its secure recovery link;
//   - private RSVPs, and guests who are not approved or not going: nothing is
//     sent, the delivery is parked `rsvp_not_eligible`, no token is written;
//   - the #871 "connect attendance" link goes ONLY to the primary guest of a
//     PUBLIC RSVP. claim_attendance_internal_v2 rejects anything else, so an
//     unlisted RSVP's pass must not carry it.
//   - the event read is bound to the RSVP's own event.
//
// fails-on-revert:
//   - pass helper back to public-only        -> hidden cases send nothing, R-01 reds
//   - attendance link back on every primary  -> hidden primary carries it, R-01 reds
//   - private admitted                       -> R-01 private rows red
//   - approval / going check dropped         -> R-02 reds
//
// Run: deno test --import-map=supabase/functions/rsvp-notify/__tests__/_importmap.test.json
//        --allow-read --no-check <this file>
import { getCapturedHandler } from "../../_shared/__tests__/_serveShim.ts";

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
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const RSVP_ID = "22222222-2222-4222-8222-222222222222";
const GUEST_ID = "33333333-3333-4333-8333-333333333333";
const PASS_URL = "https://host.usemingla.com/rsvp/pass#";
const CLAIM_URL = "https://host.usemingla.com/attendance/claim#";

const fixtureEnv: Record<string, string> = {
  SUPABASE_URL: ORIGIN,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only",
  RESEND_API_KEY: "fixture-resend-only",
  // Test-only sender address fallback in _shared/email; no product branch.
  DENO_TESTING: "1",
  "app.qr_token_pepper": "fixture-pepper-3443-not-a-real-secret-123456789",
  SMS_LIVE_ENABLED_US: "true",
  TWILIO_ACCOUNT_SID: "ACfixture",
  TWILIO_AUTH_TOKEN: "fixture-only",
  TWILIO_MESSAGING_SERVICE_SID: "MGfixture",
};

interface Scenario {
  visibility: string;
  role: "primary" | "guest";
  channel: "email" | "sms";
  rsvpStatus: string;
  approvalStatus: string;
}

interface Observed {
  providers: Array<{ kind: "email" | "sms"; body: Record<string, unknown> }>;
  completions: Array<Record<string, unknown>>;
  tokenWrites: Array<{ table: string; body: Record<string, unknown> }>;
  eventReads: string[];
  rejected: string[];
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

function installFixture(scenario: () => Scenario, seen: Observed): () => void {
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
      const body = req.method === "GET" ? null : await req.json();
      if (leaf === "claim_rsvp_notification_deliveries") {
        return jsonResponse([{
          delivery_id: "fixture-delivery",
          notification_id: "fixture-notification",
          channel: s.channel,
          attempt_count: 1,
          lease_id: "fixture-lease",
          template_key: "rsvp_pass",
          idempotency_key: "fixture-key",
          payload: {
            rsvpId: RSVP_ID,
            entityId: s.role === "primary" ? RSVP_ID : GUEST_ID,
            role: s.role,
            recipientEmail: "nobody@example.invalid",
            recipientPhone: "+15551234567",
            eventName: "Fixture RSVP",
            brandName: "Fixture host",
            recipientName: "Fixture guest",
            dateLine: "Fixture date",
            venueLine: "Fixture venue",
            qrCode: "fixture-qr-payload",
          },
        }]);
      }
      if (leaf === "finish_rsvp_notification_delivery") {
        seen.completions.push(body);
        return jsonResponse(true);
      }
      if (leaf === "can_send" || leaf === "mark_rsvp_notification_provider_io") {
        return jsonResponse(true);
      }
      if (leaf === "notification_categories") {
        return jsonResponse({
          key: "rsvp_pass",
          active: true,
          default_channels: ["email", "sms"],
        });
      }
      if (leaf === "events" && req.method === "GET") {
        seen.eventReads.push(url.searchParams.get("id") ?? "");
        return jsonResponse({
          status: "scheduled",
          visibility: s.visibility,
          deleted_at: null,
          event_type: "rsvp",
          brands: { deleted_at: null },
        });
      }
      if (leaf === "event_rsvps" || leaf === "event_rsvp_guests") {
        const expectedId = leaf === "event_rsvps" && url.searchParams.get("select")
            ?.includes("rsvp_status")
          ? RSVP_ID
          : s.role === "primary"
          ? RSVP_ID
          : GUEST_ID;
        if (url.searchParams.get("id") !== `eq.${expectedId}`) {
          seen.rejected.push(`${req.method} ${leaf} ${url.search}`);
          throw new Error("RSVP row read with the wrong id");
        }
        if (req.method === "PATCH") {
          seen.tokenWrites.push({ table: leaf, body });
          return jsonResponse(null);
        }
        return jsonResponse({
          event_id: EVENT_ID,
          rsvp_status: s.rsvpStatus,
          approval_status: s.approvalStatus,
          pass_recovery_token_hash: null,
          pass_recovery_token_created_at: "2026-09-15T00:00:00.000Z",
        });
      }
    }
    if (url.href === "https://api.resend.com/emails") {
      seen.providers.push({ kind: "email", body: await req.json() });
      return jsonResponse({ id: "fixture-email" });
    }
    if (
      url.href ===
        "https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json"
    ) {
      seen.providers.push({
        kind: "sms",
        body: Object.fromEntries(new URLSearchParams(await req.text())),
      });
      return jsonResponse({ sid: "fixture-sms" });
    }
    seen.rejected.push(`${req.method} ${url.origin}${url.pathname}`);
    throw new Error("Unexpected external request blocked");
  };
  return () => {
    globalThis.fetch = previousFetch;
    Deno.env.get = previousGet;
  };
}

async function runWorker(
  scenarioRef: { current: Scenario },
  seen: Observed,
  scenario: Scenario,
): Promise<void> {
  scenarioRef.current = scenario;
  seen.providers.length = 0;
  seen.completions.length = 0;
  seen.tokenWrites.length = 0;
  seen.eventReads.length = 0;
  const handler = getCapturedHandler();
  assert(handler, "rsvp-notify must register its handler through serve()");
  const response = await handler(
    new Request("http://localhost/rsvp-notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-service-only",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
  assert(response.status === 200, `worker answered ${response.status}`);
  await response.body?.cancel();
  same(seen.rejected, [], "no unrecognised outbound request");
}

function assertNotSent(seen: Observed, label: string): void {
  same(seen.providers.length, 0, `${label}: no provider request`);
  same(seen.tokenWrites.length, 0, `${label}: no recovery token written`);
  same(seen.completions.length, 1, `${label}: exactly one completion`);
  same(
    [seen.completions[0]?.p_status, seen.completions[0]?.p_safe_error_code],
    ["failed_terminal", "rsvp_not_eligible"],
    `${label}: parked as not eligible`,
  );
}

const scenarioRef: { current: Scenario } = {
  current: {
    visibility: "public",
    role: "primary",
    channel: "email",
    rsvpStatus: "going",
    approvalStatus: "approved",
  },
};
const seen: Observed = {
  providers: [],
  completions: [],
  tokenWrites: [],
  eventReads: [],
  rejected: [],
};

Deno.test({
  name:
    "R-01 visibility x role x channel: pass for public + unlisted, attendance link for public primary only, nothing for private",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const restore = installFixture(() => scenarioRef.current, seen);
    try {
      await import("../index.ts");
      for (const visibility of ["public", "hidden", "private"]) {
        for (const role of ["primary", "guest"] as const) {
          for (const channel of ["email", "sms"] as const) {
            const label = `${visibility}/${role}/${channel}`;
            await runWorker(scenarioRef, seen, {
              visibility,
              role,
              channel,
              rsvpStatus: "going",
              approvalStatus: "approved",
            });
            same(seen.eventReads, [`eq.${EVENT_ID}`], `${label}: reads the RSVP's own event`);
            if (visibility === "private") {
              assertNotSent(seen, label);
              continue;
            }
            same(seen.completions[0]?.p_status, "sent", `${label}: sent`);
            same(seen.providers.length, 1, `${label}: one provider request`);
            same(seen.providers[0].kind, channel, `${label}: on its own channel`);
            const outgoing = channel === "email"
              ? `${seen.providers[0].body.text}\n${seen.providers[0].body.html}`
              : String(seen.providers[0].body.Body);
            assert(
              outgoing.includes(PASS_URL),
              `${label}: the secure pass link must be in the message`,
            );
            const expectClaim = visibility === "public" && role === "primary";
            same(
              outgoing.includes(CLAIM_URL),
              expectClaim,
              `${label}: attendance link present only for a public RSVP's primary guest`,
            );
            same(seen.tokenWrites.length, 1, `${label}: one recovery token write`);
            same(
              seen.tokenWrites[0].table,
              role === "primary" ? "event_rsvps" : "event_rsvp_guests",
              `${label}: token written to the recipient's own row`,
            );
            same(
              Object.keys(seen.tokenWrites[0].body).sort(),
              ["pass_recovery_token_created_at", "pass_recovery_token_hash"],
              `${label}: only the hash and its timestamp are stored`,
            );
            if (channel === "email") {
              const attachments = seen.providers[0].body.attachments as Array<
                { filename: string; content: string }
              >;
              same(attachments.length, 1, `${label}: one attachment`);
              same(attachments[0].filename, "rsvp-pass.pdf", `${label}: the pass PDF`);
              assert(
                atob(attachments[0].content).startsWith("%PDF-"),
                `${label}: the attachment is a real PDF`,
              );
            }
          }
        }
      }
    } finally {
      restore();
    }
  },
});

Deno.test({
  name:
    "R-02 an unlisted RSVP still sends nothing to a guest who is not approved or not going",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const restore = installFixture(() => scenarioRef.current, seen);
    try {
      await import("../index.ts");
      const cases: Array<[string, string]> = [
        ["going", "pending"],
        ["going", "denied"],
        ["not_going", "approved"],
        ["maybe", "approved"],
      ];
      for (const [rsvpStatus, approvalStatus] of cases) {
        for (const role of ["primary", "guest"] as const) {
          const label = `hidden/${role}/${rsvpStatus}/${approvalStatus}`;
          await runWorker(scenarioRef, seen, {
            visibility: "hidden",
            role,
            channel: "email",
            rsvpStatus,
            approvalStatus,
          });
          same(seen.eventReads, [], `${label}: stops before reading the event`);
          assertNotSent(seen, label);
        }
      }
    } finally {
      restore();
    }
  },
});
