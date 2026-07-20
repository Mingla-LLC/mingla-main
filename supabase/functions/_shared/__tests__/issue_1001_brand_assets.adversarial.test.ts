// ISSUE-1001 [brand logo consolidation] — TESTER ADVERSARIAL suite (reserved
// path, SPEC #1001 §4.6). Attack angles DELIBERATELY DIFFERENT from the
// implementor happy-path suite (issue_1001_brand_assets.test.ts):
//
//   A1  hostile env values (empty / whitespace-mix / newline-tab garbage) can
//       never leak into the resolved logo URL — canonical default always wins.
//   A2  padded env URL (trailing/leading spaces) is trimmed BEFORE it reaches
//       the rendered src attribute — the padded variant must never appear in
//       html (a space inside src breaks the attribute on strict clients).
//   A3  brandInviteEmail CALLER-OVERRIDE PRECEDENCE: input.logoUrl beats the
//       env override, which beats the default (three-level precedence pinned).
//   A4  resolver output is always a parseable https URL (new URL() proof) —
//       the PDF entrypoints' module-level binding can therefore never be null
//       or unfetchable-by-shape under ANY of the hostile env values.
//   A5  SINGLE-OWNER RULE: _shared/brandAssets.ts is the only production file
//       allowed to READ the MINGLA_LOGO_URL env with a fallback. Any other
//       read must be the exact pass-through form `?? undefined` (which falls
//       through to minglaLogoUrl() downstream). `?? null` and `?? "literal"`
//       fallbacks are the proven pre-#1001 bug classes and are banned.
//   A6  with env unset, the transactional + marketing + invite renders carry
//       ZERO `www.usemingla.com` and ZERO dead literals (assembled from parts
//       below so this file never trips issue-1001-dead-logo-urls.mjs).
//
// fails-on-revert: reverting _shared/brandInviteEmail.ts (dead param default
// returns) fails A3/A6-invite; reverting ticket-pdf-fetch/index.ts (nullable
// env read returns) fails A5.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Sender/footer envs BEFORE importing renderers (house pattern per
// _shared/email/__tests__/shell.test.ts).
Deno.env.set("DENO_TESTING", "1");
Deno.env.delete("MINGLA_LOGO_URL");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
Deno.env.set("MINGLA_FROM_EMAIL", "hello@send.usemingla.com");
Deno.env.set("RESEND_TICKET_FROM", "Mingla <tickets@usemingla.com>");
Deno.env.set("RESEND_ADMIN_FROM", "Mingla <hello@usemingla.com>");
Deno.env.set("RESEND_SYSTEM_FROM", "Mingla <notifications@usemingla.com>");

const { DEFAULT_MINGLA_LOGO_URL, minglaLogoUrl } = await import(
  "../brandAssets.ts"
);
const { renderTransactionalEmail } = await import("../email/index.ts");
const { renderMarketingEmail } = await import("../marketingEmailRender.ts");
const { buildInviteEmail } = await import("../brandInviteEmail.ts");
import type { RenderInput, TicketBodyInput } from "../email/types.ts";

const CANONICAL = "https://usemingla.com/brand/email/mingla-wordmark-email.png";
// Assembled from parts — this file must never carry the banned literals
// verbatim (the dead-logo-urls gate scans every tracked text file and
// self-excludes ONLY itself).
const DEAD_EMAIL_ASSETS = ["usemingla.com", "email-assets", "mingla-logo.png"]
  .join("/");
const DEAD_ROOT_LOGO = ["usemingla.com", "logo.png"].join("/");

function ticketFixture(): RenderInput {
  const body: TicketBodyInput = {
    variant: "ticket_confirmation_paid",
    event: {
      title: "Adversarial Night",
      coverMediaUrl: "https://cdn.usemingla.com/events/adv.jpg",
      coverMediaType: "image",
      locationText: "Test Hall",
      isOnline: false,
      startAt: "2026-08-01T18:00:00Z",
      endAt: "2026-08-01T20:00:00Z",
      timezone: "Europe/London",
    },
    brand: { name: "Adversary Co", profilePhotoUrl: null },
    order: {
      id: "order_adv_1001",
      shortId: "adv01001",
      totalCents: 1000,
      currency: "GBP",
      buyerName: "Tester",
      lineItems: [{
        ticketName: "GA",
        quantity: 1,
        unitPriceCents: 1000,
        totalCents: 1000,
      }],
      tickets: [{ ticketId: "t1", ticketName: "GA" }],
    },
  };
  return {
    variant: "ticket_confirmation_paid",
    recipient: { name: "Tester", email: "tester@example.com" },
    body,
  };
}

function inviteFixture(logoUrl?: string) {
  return buildInviteEmail({
    inviteeName: "Jamie",
    inviteeEmail: "jamie@example.com",
    brandName: "Adversary Co",
    inviterName: "Seth",
    role: "manager",
    acceptUrl: "https://business.usemingla.com/accept-invite?token=tok",
    from: "Mingla <hello@usemingla.com>",
    ...(logoUrl !== undefined ? { logoUrl } : {}),
  });
}

const HOSTILE_ENV_VALUES = ["", "   ", "\t", "\n", " \t\n ", " 	"];

Deno.test("A1: hostile env values (empty/whitespace/control-ws) never leak — canonical default wins", () => {
  try {
    for (const hostile of HOSTILE_ENV_VALUES) {
      Deno.env.set("MINGLA_LOGO_URL", hostile);
      assertEquals(
        minglaLogoUrl(),
        CANONICAL,
        `hostile env ${JSON.stringify(hostile)} leaked past the trim guard`,
      );
    }
  } finally {
    Deno.env.delete("MINGLA_LOGO_URL");
  }
});

Deno.test("A2: padded env URL is trimmed before the src attribute — padded variant never appears in html", () => {
  try {
    Deno.env.set("MINGLA_LOGO_URL", "  https://cdn.example/custom-logo.png  ");
    const result = renderTransactionalEmail(ticketFixture());
    assertStringIncludes(result.html, "https://cdn.example/custom-logo.png");
    assert(
      !result.html.includes(" https://cdn.example/custom-logo.png "),
      "padded (untrimmed) URL leaked into the rendered html",
    );
    assert(
      !result.html.includes('src=" '),
      "src attribute begins with whitespace — trim guard bypassed at render",
    );
  } finally {
    Deno.env.delete("MINGLA_LOGO_URL");
  }
});

Deno.test("A3: brandInviteEmail precedence — caller override beats env override beats default", () => {
  try {
    // Level 1: caller wins over a SET env.
    Deno.env.set("MINGLA_LOGO_URL", "https://env.example/env-logo.png");
    const callerWins = inviteFixture("https://caller.example/override.png");
    assertStringIncludes(callerWins.html, "https://caller.example/override.png");
    assert(
      !callerWins.html.includes("https://env.example/env-logo.png"),
      "env override leaked past an explicit caller logoUrl",
    );
    assert(
      !callerWins.html.includes(CANONICAL),
      "default leaked past an explicit caller logoUrl",
    );

    // Level 2: env wins when the caller passes nothing.
    const envWins = inviteFixture();
    assertStringIncludes(envWins.html, "https://env.example/env-logo.png");

    // Level 3: default when neither.
    Deno.env.delete("MINGLA_LOGO_URL");
    const defaultWins = inviteFixture();
    assertStringIncludes(defaultWins.html, CANONICAL);
  } finally {
    Deno.env.delete("MINGLA_LOGO_URL");
  }
});

Deno.test("A4: resolver output is always a parseable https URL (PDF binding can never be null/unfetchable-by-shape)", () => {
  try {
    for (const hostile of [undefined, ...HOSTILE_ENV_VALUES]) {
      if (hostile === undefined) Deno.env.delete("MINGLA_LOGO_URL");
      else Deno.env.set("MINGLA_LOGO_URL", hostile);
      const resolved = minglaLogoUrl();
      assert(resolved.length > 0, "resolver returned an empty string");
      const parsed = new URL(resolved); // throws on garbage → test fails
      assertEquals(parsed.protocol, "https:");
      assertEquals(resolved, DEFAULT_MINGLA_LOGO_URL);
    }
  } finally {
    Deno.env.delete("MINGLA_LOGO_URL");
  }
});

Deno.test("A5: single-owner rule — no production function file reads MINGLA_LOGO_URL with any fallback except brandAssets.ts; PDF entrypoints bind via minglaLogoUrl()", () => {
  const functionsRoot = new URL("../..", import.meta.url);
  const offenders: string[] = [];
  const passThroughs: string[] = [];

  const walk = (dir: URL) => {
    for (const entry of Deno.readDirSync(dir)) {
      const child = new URL(
        entry.isDirectory ? `${entry.name}/` : entry.name,
        dir,
      );
      if (entry.isDirectory) {
        if (entry.name === "__tests__" || entry.name === "node_modules") {
          continue;
        }
        walk(child);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const rel = child.pathname.slice(functionsRoot.pathname.length);
      if (rel === "_shared/brandAssets.ts") continue; // the ONE owner
      const src = Deno.readTextFileSync(child);
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes('Deno.env.get("MINGLA_LOGO_URL")')) continue;
        if (lines[i].includes('Deno.env.get("MINGLA_LOGO_URL") ?? undefined')) {
          passThroughs.push(`${rel}:${i + 1}`);
          continue;
        }
        offenders.push(`${rel}:${i + 1} → ${lines[i].trim()}`);
      }
      // The two PDF entrypoints must bind through the resolver.
      if (
        rel === "ticket-confirmation-dispatch/index.ts" ||
        rel === "ticket-pdf-fetch/index.ts"
      ) {
        assertStringIncludes(
          src,
          "const MINGLA_LOGO_URL = minglaLogoUrl();",
          `${rel} lost its minglaLogoUrl() binding`,
        );
        assert(
          !src.includes('Deno.env.get("MINGLA_LOGO_URL") ?? null'),
          `${rel} regressed to the pre-#1001 nullable env read`,
        );
      }
    }
  };
  walk(functionsRoot);

  assertEquals(
    offenders,
    [],
    "direct MINGLA_LOGO_URL env reads with a non-pass-through fallback " +
      "(the pre-#1001 bug class) found — route through " +
      "_shared/brandAssets.ts minglaLogoUrl() instead",
  );
  // The known safe pass-throughs feed buildInviteEmail(input.logoUrl ?? ...)
  // and MUST stay `?? undefined` so the canonical default still applies.
  for (const p of passThroughs) {
    assert(
      p.startsWith("invite-brand-member/") ||
        p.startsWith("partner-reissue-invitation/") ||
        p.startsWith("ticket-confirmation-dispatch/"),
      `unexpected new MINGLA_LOGO_URL pass-through read at ${p} — ` +
        "prefer importing minglaLogoUrl() directly",
    );
  }
});

Deno.test("A6: with env unset, transactional + marketing + invite html carry ZERO www-host and ZERO dead literals", () => {
  Deno.env.delete("MINGLA_LOGO_URL");
  const renders: [string, string][] = [
    ["transactional", renderTransactionalEmail(ticketFixture()).html],
    [
      "marketing",
      renderMarketingEmail({
        body_html: "<p>Hi {first_name}</p>",
        variables: {
          first_name: "Ada",
          event_name: null,
          event_date: null,
          event_time: null,
          doors_open: null,
          ends_at: null,
          brand_name: "Adversary Co",
          event_url: null,
          spots_left: null,
          previous_event_name: null,
          next_event_name: null,
          event_id: null,
        },
        embedded_events: [],
        unsubscribe_url: "https://usemingla.com/unsubscribe/tok",
        subject: "Hi",
        brand_name: "Adversary Co",
      }).html,
    ],
    ["invite", inviteFixture().html],
  ];
  for (const [name, html] of renders) {
    assert(
      !html.includes(DEAD_EMAIL_ASSETS),
      `${name}: dead email-assets literal leaked`,
    );
    assert(
      !html.includes(DEAD_ROOT_LOGO),
      `${name}: dead root logo literal leaked`,
    );
    assert(
      !html.includes("www.usemingla.com"),
      `${name}: www host leaked (bare-host canon violated)`,
    );
    assertStringIncludes(html, CANONICAL);
  }
});
