// ORCH-1329 / #948 W3 [single invite CTA + AA button-contrast fix] — TESTER
// adversarial regression.
//
// This is the tester's INDEPENDENT second test. It deliberately attacks a
// DIFFERENT ANGLE than the implementor's happy-path test
// (orch-1329-download-cta.test.ts, which asserts the download URL is present
// and the primary fill colour). This suite instead attacks:
//
//   1. ESCAPE / XSS — malicious brandName / inviterName / personalNote /
//      inviteeName must be ENTITY-ESCAPED (raw tag-breakout string ABSENT),
//      for BOTH variants and across the NEW polish blocks (eyebrow chip,
//      lead line, steps, trust card, role-clarity, secondary card, note).
//      Different from orch-1050's escape test, which only asserts the escaped
//      form is *present* for the standard variant — never that the raw
//      payload is *absent*, never the partner variant, note, or inviteeName,
//      and never the attribute-breakout `"><img onerror>` vector.
//   2. SINGLE-CTA — neither variant may contain the retired download CTA;
//      partner setup says "Claim & add your bank", standard says "Accept
//      invitation", and the one primary CTA still carries the accept token.
//   3. BOTH-VARIANTS COMPLETENESS across ALL six roles (incl. scanner +
//      finance_manager) — exact variant CTA + accept token in html AND text,
//      with no download secondary.
//   4. AA CONTRAST INVARIANT — no white-text button fill on #FF6B2C OR
//      #F97316; primary fill is #C4471A; AND the fix was SURGICAL: the
//      decorative #FF6B2C personal-note rule is PRESERVED.
//   5. CROSS-SURFACE NON-REGRESSION — the ticket / generic (shell-wrapped)
//      and trip / experience (self-contained) renderers still emit a complete
//      email (exactly one doctype) with their action button darkened to
//      #C4471A and their core content intact.
//
// Fails-on-revert (tester-verified locally):
//   - un-escape any brand/inviter/note interpolation in buildInviteEmail →
//     the ESCAPE suite FAILs (raw tag-breakout string reappears).
//   - restore the secondary /business/download block → SINGLE-CTA FAILs.
//
// Run: DENO_TESTING=1 deno test --allow-env --allow-net \
//   supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

// Cross-surface renderers read sender/logo env at MODULE LOAD (EMAIL_SENDERS)
// or call time. Set env BEFORE importing so the shared module resolves the
// non-sandbox senders and the DENO_TESTING fallbacks fire (mirrors
// _shared/email/__tests__/shell.test.ts).
Deno.env.set("DENO_TESTING", "1");
// ISSUE-1001 [brand logo consolidation]: env pins the canonical bare-host URL
// (the module's live default) — the dead email-assets literal is eliminated.
Deno.env.set(
  "MINGLA_LOGO_URL",
  "https://usemingla.com/brand/email/mingla-wordmark-email.png",
);
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");
Deno.env.set("MINGLA_FROM_EMAIL", "hello@send.usemingla.com");
Deno.env.set("RESEND_TICKET_FROM", "Mingla <tickets@usemingla.com>");
Deno.env.set("RESEND_ADMIN_FROM", "Mingla <hello@usemingla.com>");
Deno.env.set("RESEND_SYSTEM_FROM", "Mingla <notifications@usemingla.com>");

const { buildInviteEmail } = await import("../index.ts");
const { renderTransactionalEmail } = await import(
  "../../_shared/email/index.ts"
);
const { renderTripConfirmationEmail } = await import(
  "../../_shared/email/tripConfirmationEmail.ts"
);
const { renderExperienceConfirmationEmail } = await import(
  "../../_shared/email/experienceConfirmationEmail.ts"
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCEPT_URL =
  "https://host.usemingla.com/accept-brand-invitation?token=SECRET_TOKEN_9f3a";

// Attribute-breakout + script-injection payloads. Each is distinct so we can
// tell which field leaked if an assertion fires.
const XSS_BRAND = `"><img src=x onerror=alert('brand')>`;
const XSS_INVITER = `<script>alert('inviter')</script>`;
const XSS_NOTE = `</td><script>alert('note')</script>`;
const XSS_INVITEE = `<svg/onload=alert('name')>`;

function buildXss(partnerSetup: boolean) {
  return buildInviteEmail({
    inviteeName: XSS_INVITEE,
    inviteeEmail: "victim@example.com",
    brandName: XSS_BRAND,
    inviterName: XSS_INVITER,
    role: partnerSetup ? "brand_owner" : "event_manager",
    acceptUrl: ACCEPT_URL,
    from: "Mingla <noreply@usemingla.com>",
    partnerSetup,
    // personalNote only renders in the partner HTML body, but pass it in both
    // so a future template change that surfaces it in the standard variant is
    // also guarded.
    personalNote: XSS_NOTE,
  });
}

// ===========================================================================
// 1. ESCAPE / XSS — raw payload must NOT survive unescaped (BOTH variants)
// ===========================================================================

for (const partnerSetup of [true, false]) {
  const variant = partnerSetup ? "partner-setup" : "standard";
  Deno.test(`ORCH-1329 tester — ${variant}: hostile brand/inviter/note/name are entity-escaped, never raw`, () => {
    const p = buildXss(partnerSetup);

    // (a) No raw tag-breakout string survives anywhere in the HTML. If any of
    // these appear verbatim the mail client would execute/inject them.
    for (
      const raw of [
        XSS_BRAND, // `"><img src=x onerror=alert('brand')>`
        XSS_INVITER, // `<script>alert('inviter')</script>`
        XSS_NOTE, // `</td><script>alert('note')</script>`
        XSS_INVITEE, // `<svg/onload=alert('name')>`
      ]
    ) {
      assert(
        !p.html.includes(raw),
        `RAW hostile payload leaked UNESCAPED into ${variant} html: ${raw}`,
      );
    }

    // (b) No tag-opening primitive from an attacker-controlled field survives.
    // (These sequences can only exist if escaping was removed — the shell's
    // own static markup never contains them.)
    for (
      const needle of [
        "<img src=x onerror",
        "<script>alert(",
        "<svg/onload=",
      ]
    ) {
      assert(
        !p.html.includes(needle),
        `tag-opening primitive survived in ${variant} html: ${needle}`,
      );
    }

    // (c) Proof the payload was ESCAPED (entity-encoded), not merely stripped —
    // the escaped forms MUST be present (escapeHtml turns < > " ' & into
    // entities). This distinguishes "escaped" from "silently dropped".
    assertStringIncludes(p.html, "&lt;img src=x onerror=alert(&#39;brand&#39;)&gt;");
    assertStringIncludes(p.html, "&lt;script&gt;alert(&#39;inviter&#39;)&lt;/script&gt;");
    assertStringIncludes(p.html, "&lt;svg/onload=alert(&#39;name&#39;)&gt;");
  });
}

Deno.test("ORCH-1329 tester — partner personal note is escaped inside the note card (no </td> breakout)", () => {
  const p = buildXss(true);
  // The note renders in the partner variant. The `</td>` breakout must be
  // neutralised, and the escaped note must be present.
  assert(
    !p.html.includes("</td><script>alert('note')</script>"),
    "personal note broke out of its table cell unescaped",
  );
  assertStringIncludes(
    p.html,
    "&lt;/td&gt;&lt;script&gt;alert(&#39;note&#39;)&lt;/script&gt;",
  );
});

// ===========================================================================
// 2. SINGLE CTA / ACCEPT TARGET
// ===========================================================================

for (const partnerSetup of [true, false]) {
  const variant = partnerSetup ? "partner-setup" : "standard";
  Deno.test(`#948 W3 tester — ${variant}: exactly the approved primary CTA remains and it carries the accept token`, () => {
    const p = buildInviteEmail({
      inviteeName: "Amara",
      inviteeEmail: "amara@example.com",
      brandName: "Zuri Kitchen",
      inviterName: "David Okon",
      role: partnerSetup ? "brand_owner" : "scanner",
      acceptUrl: ACCEPT_URL,
      from: "Mingla <noreply@usemingla.com>",
      partnerSetup,
    });

    assertStringIncludes(p.html, `<a href="${ACCEPT_URL}"`);
    assert(
      !p.html.includes("business/download"),
      `${variant} html restored the retired download secondary`,
    );
    assert(
      !p.text.includes("business/download"),
      `${variant} text restored the retired download secondary`,
    );
    assert(
      !p.html.includes("Get the Mingla Host app"),
      `${variant} html restored the retired download label`,
    );
    assertStringIncludes(
      p.html,
      partnerSetup ? "Claim &amp; add your bank" : "Accept invitation",
    );
    assertStringIncludes(
      p.text,
      partnerSetup ? "Claim & add your bank:" : "Accept your invitation:",
    );
    assertStringIncludes(p.text, "SECRET_TOKEN_9f3a");
  });
}

// ===========================================================================
// 3. BOTH-VARIANTS COMPLETENESS — ALL roles, html + text
// ===========================================================================

const ALL_ROLES = [
  "brand_owner",
  "brand_admin",
  "event_manager",
  "finance_manager",
  "marketing_manager",
  "scanner",
];

for (const partnerSetup of [true, false]) {
  const variant = partnerSetup ? "partner-setup" : "standard";
  for (const role of ALL_ROLES) {
    Deno.test(`#948 W3 tester — completeness ${variant}/${role}: one exact CTA + accept token in html AND text`, () => {
      const p = buildInviteEmail({
        inviteeName: "Amara",
        inviteeEmail: "amara@example.com",
        brandName: "Zuri Kitchen",
        inviterName: "David Okon",
        role,
        acceptUrl: ACCEPT_URL,
        from: "Mingla <noreply@usemingla.com>",
        partnerSetup,
        personalNote: partnerSetup ? "Welcome aboard!" : null,
      });
      assertStringIncludes(p.html, "SECRET_TOKEN_9f3a");
      assertStringIncludes(p.text, "SECRET_TOKEN_9f3a");
      assert(
        !p.html.includes("business/download") &&
          !p.text.includes("business/download") &&
          !p.html.includes("Get the Mingla Host app"),
        `${variant}/${role} must remain single-CTA`,
      );
      assertStringIncludes(
        p.html,
        partnerSetup ? "Claim &amp; add your bank" : "Accept invitation",
      );
    });
  }
}

// ===========================================================================
// 4. AA CONTRAST INVARIANT — surgical: no failing button fill, decorative kept
// ===========================================================================

for (const partnerSetup of [true, false]) {
  const variant = partnerSetup ? "partner-setup" : "standard";
  Deno.test(`ORCH-1329 tester — ${variant}: AA button fill = #C4471A; no #FF6B2C/#F97316 fill`, () => {
    const p = buildInviteEmail({
      inviteeName: "Amara",
      inviteeEmail: "amara@example.com",
      brandName: "Zuri Kitchen",
      inviterName: "David Okon",
      role: partnerSetup ? "brand_owner" : "event_manager",
      acceptUrl: ACCEPT_URL,
      from: "Mingla <noreply@usemingla.com>",
      partnerSetup,
      personalNote: partnerSetup ? "Go live!" : null,
    });

    // Primary button uses the AA-safe fill.
    assertStringIncludes(p.html, "background:#C4471A");

    // NO white-text CTA button fill remains on either failing orange.
    assert(
      !p.html.includes("background:#FF6B2C"),
      "a CTA button fill remains on #FF6B2C (white-on-fill 2.84:1, fails WCAG AA)",
    );
    assert(
      !p.html.includes("background:#F97316"),
      "a CTA button fill remains on #F97316 (fails WCAG AA)",
    );

  });
}

Deno.test("ORCH-1329 tester — partner note keeps its decorative #FF6B2C left rule (surgical fix)", () => {
  const p = buildInviteEmail({
    inviteeName: "Amara",
    inviteeEmail: "amara@example.com",
    brandName: "Zuri Kitchen",
    inviterName: "David Okon",
    role: "brand_owner",
    acceptUrl: ACCEPT_URL,
    from: "Mingla <noreply@usemingla.com>",
    partnerSetup: true,
    personalNote: "Take it live!",
  });
  assertStringIncludes(p.html, "border-left:3px solid #FF6B2C");
});

// ===========================================================================
// 5. CROSS-SURFACE NON-REGRESSION — ticket / generic / trip / experience
// ===========================================================================

// The needle is assembled from fragments so this test file never contains the
// literal doctype string — the ORCH-0785-D shell-singleton gate greps every
// .ts under supabase/functions/** (it does NOT skip __tests__) and would flag
// a verbatim doctype declaration here as a rogue second shell.
const DOCTYPE_RE = new RegExp("<!" + "doctype html>", "gi");

function countDoctypes(html: string): number {
  return (html.match(DOCTYPE_RE) ?? []).length;
}

function ticketFixture() {
  return {
    variant: "ticket_confirmation_paid" as const,
    recipient: { name: "Buyer", email: "buyer@example.com" },
    body: {
      variant: "ticket_confirmation_paid" as const,
      event: {
        title: "Sunset Sail",
        coverMediaUrl: "https://cdn.usemingla.com/events/sunset.jpg",
        coverMediaType: "image" as const,
        locationText: "Brighton Marina",
        isOnline: false,
        startAt: "2026-06-12T18:00:00Z",
        endAt: "2026-06-12T20:00:00Z",
        timezone: "Europe/London",
      },
      brand: { name: "Coastline Co", profilePhotoUrl: null },
      order: {
        id: "order_fixture_123",
        shortId: "abcd1234",
        totalCents: 5000,
        currency: "GBP",
        buyerName: "Buyer Name",
        lineItems: [{
          ticketName: "General",
          quantity: 2,
          unitPriceCents: 2500,
          totalCents: 5000,
        }],
        tickets: [
          { ticketId: "t1", ticketName: "General" },
          { ticketId: "t2", ticketName: "General" },
        ],
      },
    },
  };
}

Deno.test("ORCH-1329 tester — cross-surface: ticket email complete (1 doctype), CTA fill #C4471A, content intact", () => {
  const r = renderTransactionalEmail(ticketFixture());
  assertEquals(countDoctypes(r.html), 1, "ticket email must have exactly one doctype");
  assertStringIncludes(r.html, "background:#C4471A");
  assert(!r.html.includes("background:#F97316"), "ticket CTA still on #F97316");
  assert(!r.html.includes("background:#FF6B2C"), "ticket CTA still on #FF6B2C");
  // Core content unchanged.
  assertStringIncludes(r.html, "Sunset Sail");
  assertStringIncludes(r.html, "Total");
  assertStringIncludes(r.html, "Open in Mingla");
  assertStringIncludes(r.text, "Sunset Sail");
});

Deno.test("ORCH-1329 tester — cross-surface: generic email complete (1 doctype), CTA fill #C4471A, content intact", () => {
  const r = renderTransactionalEmail({
    variant: "generic_notification" as const,
    recipient: { name: null, email: "x@y.z" },
    body: {
      variant: "generic_notification" as const,
      title: "Heads up",
      paragraphs: ["Para1", "Para2"],
      cta: { label: "Open Mingla Host", url: "https://usemingla.com/business" },
    },
  });
  assertEquals(countDoctypes(r.html), 1, "generic email must have exactly one doctype");
  assertStringIncludes(r.html, "background:#C4471A");
  assert(!r.html.includes("background:#FF6B2C"), "generic CTA still on #FF6B2C");
  assert(!r.html.includes("background:#F97316"), "generic CTA still on #F97316");
  assertStringIncludes(r.html, "Heads up");
  assertStringIncludes(r.html, "Para1");
  assertStringIncludes(r.html, "Open Mingla Host");
});

Deno.test("ORCH-1329 tester — cross-surface: trip email complete (1 doctype), CTA fill #C4471A, content intact", () => {
  const r = renderTripConfirmationEmail({
    recipient: { name: "Trav", email: "trav@example.com" },
    trip: {
      title: "Atlas Ridge Escape",
      startAtIso: "2026-08-01T09:00:00Z",
      endAtIso: "2026-08-05T17:00:00Z",
      destinationText: "Marrakech",
      timezone: "Africa/Casablanca",
      days: [{ ordinal: 1, title: "Arrival" }],
      inclusions: [{ kind: "included", item: "Breakfast" }],
    },
    brand: { name: "Atlas Co", profilePhotoUrl: null },
    order: { id: "order_trip_1", shortId: "trip9999", totalCents: 120000, currency: "USD" },
  });
  assertEquals(countDoctypes(r.html), 1, "trip email must have exactly one doctype");
  assertStringIncludes(r.html, "background:#C4471A");
  assert(!r.html.includes("background:#F97316"), "trip CTA still on #F97316");
  assert(!r.html.includes("background:#FF6B2C"), "trip CTA still on #FF6B2C");
  assertStringIncludes(r.html, "You're booked");
  assertStringIncludes(r.html, "Atlas Ridge Escape");
});

Deno.test("ORCH-1329 tester — cross-surface: experience email complete (1 doctype), CTA fill #C4471A, content intact", () => {
  const r = renderExperienceConfirmationEmail({
    recipient: { name: "Ex", email: "ex@example.com" },
    experience: {
      title: "Old Town Food Crawl",
      dateIso: "2026-09-10T18:00:00Z",
      timezone: "Europe/Lisbon",
      venueText: "Alfama",
      stops: [
        { stopOrder: 1, placeName: "Tasca A", address: "Rua 1", startTime: "18:00", priceCents: null },
        { stopOrder: 2, placeName: "Tasca B", address: "Rua 2", startTime: "19:30", priceCents: null },
      ],
    },
    brand: { name: "Lisbon Bites", profilePhotoUrl: null },
    order: { id: "order_exp_1", shortId: "exp7777", totalCents: 6000, currency: "EUR" },
  });
  assertEquals(countDoctypes(r.html), 1, "experience email must have exactly one doctype");
  assertStringIncludes(r.html, "background:#C4471A");
  // Experience keeps a decorative color:#F97316 on the stop label (text, not a
  // button) — so we assert only that no BUTTON FILL is on the failing orange.
  assert(!r.html.includes("background:#F97316"), "experience CTA still on #F97316");
  assert(!r.html.includes("background:#FF6B2C"), "experience CTA still on #FF6B2C");
  assertStringIncludes(r.html, "You're reserved");
  assertStringIncludes(r.html, "Old Town Food Crawl");
});
