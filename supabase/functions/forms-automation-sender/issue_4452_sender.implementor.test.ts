// #4452 forms-automation-sender (T-5.1, 5.10, 5.11, 5.15; A1-T-10; SC-62, 74, 75, 82, A1-SC-28).
// MINGLA-INVARIANT: I-4452-TEAM-ALERT-TO | issue #4452 | a form team alert goes to exactly info@ and seth@, Reply-To the person, never to the person (A1-T-10).
// Hermetic: the real sender over a scripted gate and a captured Resend fetch.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TEAM_ALERT_TO } from "../_shared/formsSenders.ts";
import { nextLocalTime } from "../_shared/formsSchedule.ts";
import {
  formButtonHref,
  type GateSend,
  mergeTokens,
  runSender,
  type SenderDb,
} from "./sender.ts";

const SEND = "4452d000-0000-4000-8000-000000000001";

function gate(
  over: Partial<GateSend> = {},
  step: Record<string, unknown> = {},
): GateSend {
  return {
    action: "send",
    send_id: SEND,
    run_id: "4452d000-0000-4000-8000-0000000000aa",
    attempts: 1,
    email_kind: "confirmation",
    to: "ada@example.org",
    is_test: false,
    step: {
      id: "s0",
      type: "email",
      from: "creators",
      subject: "You're on the list, {first_name}",
      show_answers: true,
      action_bar: "auto",
      doc: [{
        type: "rich_text",
        html:
          "<p>Hi {first_name}, thanks for applying in {answers.city}.</p><p>Name on file: {name}</p>",
      }],
      ...step,
    },
    person: {
      email: "ada@example.org",
      name: "Ada <b>Okafor</b>",
      answers: {
        city: { label: "Lagos" },
        what_do_you_make: "Video {answers.city}",
      },
      page: "/creators",
      spot: "after-steps",
      utm_source: "meta",
      utm_campaign: "creators-lagos-nov",
      label: "creator",
      ads_allowed: true,
      click_source: "meta",
      time_zone: "Africa/Lagos",
    },
    form: {
      id: "f",
      key: "creators-join",
      name: "Creators: join",
      audience: "creator",
      fields: [{ key: "city", type: "dropdown", label: "Your city" }, {
        key: "what_do_you_make",
        type: "single",
        label: "What do you make?",
      }, { key: "consent", type: "consent", label: "Send me tips" }],
    },
    ...over,
  };
}

function harness(
  gates: Array<GateSend | { action: "skip" | "cancel"; reason: string }>,
  status = 200,
) {
  const finished: Array<[string, string, string | null]> = [];
  const posts: Array<
    { headers: Record<string, string>; body: Record<string, unknown> }
  > = [];
  let i = 0;
  const db: SenderDb = {
    claim: () => Promise.resolve([{ id: SEND, run_id: "r" }]),
    gate: () => Promise.resolve(gates[Math.min(i++, gates.length - 1)]),
    finish: (id, s, e) => (finished.push([id, s, e]), Promise.resolve()),
  };
  const fetchImpl = ((_u: string, init: RequestInit) => {
    posts.push({
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "re_1" }), { status }),
    );
  }) as unknown as typeof fetch;
  const env: Record<string, string> = {
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    RESEND_API_KEY: "re",
    UNSUBSCRIBE_TOKEN_SECRET: "s",
  };
  const deps = {
    db,
    env: (n: string) => env[n],
    fetchImpl,
    trackBase: "https://x/functions/v1/forms-track",
    signUnsubscribe: () => Promise.resolve("TOKEN"),
    log: () => {},
  };
  const req = (bearer = "svc") =>
    new Request("https://fn/", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}` },
    });
  return { finished, posts, deps, req, env };
}

Deno.test("only the service-role bearer runs the sender; FORMS_SENDER_PAUSED claims nothing", async () => {
  const h = harness([gate()]);
  assertEquals((await runSender(h.req("nope"), h.deps)).status, 401);
  h.env.FORMS_SENDER_PAUSED = "1";
  assertEquals((await (await runSender(h.req(), h.deps)).json()).paused, true);
  assertEquals(h.posts.length, 0);
});

Deno.test("T-5.1 a confirmation: escaped merge, Idempotency-Key, no List-Unsubscribe, From noreply@ with Reply-To info@", async () => {
  const h = harness([gate(), gate()]);
  await runSender(h.req(), h.deps);
  assertEquals(h.posts.length, 1);
  const p = h.posts[0];
  assertEquals(p.headers["Idempotency-Key"], `forms-send-${SEND}`);
  assertEquals(
    p.headers["List-Unsubscribe"],
    undefined,
    "SC-75 confirmations carry no List-Unsubscribe",
  );
  assertEquals(p.body.from, "Mingla Creators <noreply@usemingla.com>");
  assertEquals(p.body.reply_to, "info@usemingla.com");
  assertEquals(p.body.subject, "You're on the list, Ada");
  const html = String(p.body.html);
  assert(
    html.includes("Hi Ada, thanks for applying in Lagos."),
    "merge fields",
  );
  assertFalse(
    html.includes("<b>Okafor</b>"),
    "SC-82 merged values are escaped",
  );
  assert(
    html.includes("Video {answers.city}"),
    "no double expansion of a value that contains a token",
  );
  assert(html.includes("Start making"), "the creator action bar");
  assertFalse(
    html.includes("Unsubscribe</a>"),
    "no unsubscribe line on a confirmation",
  );
  assertEquals(h.finished, [[SEND, "sent", null]]);
});

Deno.test("T-5.11 SC-75 a follow-up carries List-Unsubscribe (https one-click) + Post and a visible link", async () => {
  const h = harness([
    gate({ email_kind: "follow_up" }),
    gate({ email_kind: "follow_up" }),
  ]);
  await runSender(h.req(), h.deps);
  const p = h.posts[0];
  assertEquals(
    p.headers["List-Unsubscribe"],
    "<https://usemingla.com/api/unsubscribe/one-click?token=TOKEN>",
  );
  assertEquals(
    p.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
  assert(
    String(p.body.html).includes(
      "https://usemingla.com/unsubscribe?token=TOKEN",
    ),
  );
  assertFalse(
    String(p.headers["List-Unsubscribe"]).includes("mailto:"),
    "no unsubscribe@ mailbox (Q-5)",
  );
});

Deno.test("#4640 form email call buttons follow stable scheduler registry keys", () => {
  assertEquals(
    formButtonHref("scheduler:host-demo"),
    "https://usemingla.com/schedule?profile=host-demo",
  );
  assertEquals(
    formButtonHref("scheduler:not/valid"),
    "https://usemingla.com/schedule",
  );
  assertEquals(
    formButtonHref("schedule_creators"),
    "https://usemingla.com/schedule/creators",
  );
});

Deno.test("A1-T-10 A1-SC-28 a team alert goes to exactly info@ and seth@, Reply-To the person, never to the person", async () => {
  const g = gate({ email_kind: "team_alert" }, {
    type: "team",
    to: "creators_inbox",
    include_answers: true,
  });
  const h = harness([g, g]);
  await runSender(h.req(), h.deps);
  const p = h.posts[0];
  assertEquals(p.body.to, ["info@usemingla.com", "seth@usemingla.com"]);
  assertEquals([...TEAM_ALERT_TO], [
    "info@usemingla.com",
    "seth@usemingla.com",
  ]);
  assertEquals(p.body.reply_to, "ada@example.org");
  assertFalse((p.body.to as string[]).includes("ada@example.org"));
  assertEquals(p.body.from, "Mingla Forms <noreply@usemingla.com>");
});

Deno.test("T-5.10 SC-74 Resend 500 → retry; 422 → failed at once", async () => {
  const a = harness([gate(), gate()], 500);
  await runSender(a.req(), a.deps);
  assertEquals(a.finished[0][1], "retry");
  const b = harness([gate(), gate()], 422);
  await runSender(b.req(), b.deps);
  assertEquals(b.finished[0][1], "failed");
  const c = harness([gate(), gate()], 429);
  await runSender(c.req(), c.deps);
  assertEquals(c.finished[0][1], "retry");
});

Deno.test("an unsubscribe between claim and send is honoured (the gate is re-checked before the POST)", async () => {
  const h = harness([gate({ email_kind: "follow_up" }), {
    action: "skip",
    reason: "unsubscribed",
  }]);
  await runSender(h.req(), h.deps);
  assertEquals(h.posts.length, 0);
});

Deno.test("links are tracked through forms-track; the unsubscribe link is not", async () => {
  const h = harness([
    gate({ email_kind: "follow_up" }),
    gate({ email_kind: "follow_up" }),
  ]);
  await runSender(h.req(), h.deps);
  const html = String(h.posts[0].body.html);
  assert(html.includes("forms-track?s="), "tracked links");
  assert(html.includes("forms-track?o="), "open pixel");
  assert(
    html.includes('href="https://usemingla.com/unsubscribe?token=TOKEN"'),
    "unsubscribe stays direct",
  );
});

Deno.test("mergeTokens is one pass and escapes", () => {
  assertEquals(
    mergeTokens("{a} {b}", { a: "{b}", b: "<x>" }, true),
    "{b} &lt;x&gt;",
  );
  assertEquals(mergeTokens("{missing}", {}, false), "");
});

Deno.test("T-5.3 the TS clock matches the four binding vectors (the SQL twin is pinned in pg17)", () => {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2026-11-14T18:00Z"),
        "Africa/Lagos",
        2,
        "days",
        true,
        false,
      ),
    ),
    "2026-11-16T09:00",
  );
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2026-11-13T18:00Z"),
        "Europe/Dublin",
        2,
        "days",
        true,
        true,
      ),
    ),
    "2026-11-17T10:00",
  );
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2026-10-24T12:00Z"),
        "Europe/London",
        1,
        "days",
        true,
        false,
      ),
    ),
    "2026-10-25T10:00",
  );
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2026-11-09T09:30Z"),
        "America/New_York",
        3,
        "hours",
        true,
        false,
      ),
    ),
    "2026-11-09T15:00",
  );
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2026-11-09T09:30Z"),
        "Not/AZone",
        3,
        "hours",
        true,
        false,
      ),
    ),
    "2026-11-10T10:00",
  );
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2026-11-13T23:30Z"),
        "Europe/Dublin",
        1,
        "hours",
        false,
        true,
      ),
    ),
    "2026-11-16T00:30",
  );
  // New York across the March change: 1 day at 10:00 lands on 14:00 UTC (EDT).
  assertEquals(
    iso(
      nextLocalTime(
        Date.parse("2027-03-13T15:00Z"),
        "America/New_York",
        1,
        "days",
        true,
        false,
      ),
    ),
    "2027-03-14T14:00",
  );
});
