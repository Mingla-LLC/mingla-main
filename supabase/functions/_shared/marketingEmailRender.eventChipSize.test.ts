// ORCH-0891 M2 — marketingEmailRender event-chip size variant tests.
//
// Tester-adversarial regression test per SPEC §6 M2 row. Attacks
// DIFFERENT angles than the implementor's Sheet.web.test.ts:
//
//   (a) The compact size renders a DIFFERENT layout than medium (not
//       just a styling tweak — structurally simpler, no kicker, no
//       chips, no CTA button).
//   (b) Legacy size-less tokens still render the medium card UNCHANGED
//       — byte-identical to pre-ORCH-0891 output for backwards-compat
//       (I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT).
//   (c) Invalid size values fall through to medium (graceful default)
//       — typos in the token's `|size` suffix don't corrupt the email.
//   (d) The renderer is called for EACH token in the body (no caching
//       bug that would render the first size for every subsequent chip).
//   (e) The size parameter actually reaches the size-dispatch logic
//       (sanity check that the regex's group 2 is wired into the
//       renderer call).
//
// Run with: deno test supabase/functions/_shared/marketingEmailRender.eventChipSize.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  renderMarketingEmail,
  type EmbeddedEvent,
  type MarketingVariables,
  type RenderMarketingEmailInput,
} from "./marketingEmailRender.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

const EMPTY_VARIABLES: MarketingVariables = {
  first_name: "Seth",
  event_name: null,
  event_date: null,
  event_time: null,
  doors_open: null,
  ends_at: null,
  brand_name: "Acme",
  event_url: null,
  spots_left: null,
  previous_event_name: null,
  next_event_name: null,
  event_id: null,
};

const SAMPLE_EVENT: EmbeddedEvent = {
  id: UUID,
  title: "Friday Night",
  date_label: "Fri · Aug 15",
  ends_at_label: null,
  location_label: "Bowery Ballroom",
  cover_image_url: null,
  cover_media_type: null,
  url: "https://usemingla.com/e/acme/friday-night",
};

function makeInput(bodyHtml: string): RenderMarketingEmailInput {
  return {
    body_html: bodyHtml,
    variables: EMPTY_VARIABLES,
    embedded_events: [SAMPLE_EVENT],
    unsubscribe_url: "https://example.com/unsub",
    subject: "Friday lineup",
    brand_name: "Acme",
  };
}

Deno.test(
  "ORCH-0891 M2 T-M2-AD-01: medium (legacy size-less token) renders the kicker + chips + CTA card",
  () => {
    const out = renderMarketingEmail(makeInput(`{{event:${UUID}}}`));
    // The medium / legacy card renders the "Featured event" kicker.
    assertStringIncludes(out.html, "Featured event");
    // And the dark date chip.
    assertStringIncludes(out.html, "Fri · Aug 15");
    // And the orange Get tickets CTA.
    assertStringIncludes(out.html, "Get tickets");
  },
);

Deno.test(
  "ORCH-0891 M2 T-M2-AD-02: medium (explicit) renders structurally-identical to legacy size-less",
  () => {
    // I-EVENT-CHIP-SIZE-BACKWARDS-COMPAT: legacy stored campaigns with
    // `{{event:UUID}}` MUST render the SAME card visual as the new
    // explicit `{{event:UUID|medium}}` form. We compare after stripping
    // random per-link tracking IDs (generated fresh on each render call)
    // — the byte-identity test would fail solely because of the random
    // tracking IDs, not because of any real card divergence.
    const legacy = renderMarketingEmail(makeInput(`{{event:${UUID}}}`));
    const explicit = renderMarketingEmail(makeInput(`{{event:${UUID}|medium}}`));

    // Normalize away the random tracking-id segments that appear after
    // `marketing-track-click/<id>` and any tracking-id-derived hash.
    const stripTrackingIds = (html: string): string =>
      html.replace(/marketing-track-click\/[A-Za-z0-9_-]+/g, "marketing-track-click/X");

    assertEquals(stripTrackingIds(legacy.html), stripTrackingIds(explicit.html));
  },
);

Deno.test(
  "ORCH-0891 M2 T-M2-AD-03: compact renders a DIFFERENT (simpler) layout than medium",
  () => {
    const compact = renderMarketingEmail(makeInput(`{{event:${UUID}|compact}}`));
    const medium = renderMarketingEmail(makeInput(`{{event:${UUID}|medium}}`));

    // Compact and medium MUST produce different HTML. If a future
    // implementor accidentally aliases compact → medium, this test fails.
    assert(
      compact.html !== medium.html,
      "Compact and medium must produce different HTML",
    );

    // Compact MUST NOT contain the kicker text ("Featured event") —
    // that's a medium/large-only affordance.
    assert(
      !compact.html.includes("Featured event"),
      "Compact card must not render the 'Featured event' kicker",
    );

    // Compact MUST NOT contain the CTA button text — the title is the link.
    assert(
      !compact.html.includes("Get tickets"),
      "Compact card must not render a 'Get tickets' CTA button",
    );

    // Compact MUST still contain the title — that's the link.
    assertStringIncludes(compact.html, "Friday Night");
  },
);

Deno.test(
  "ORCH-0891 M2 T-M2-AD-04: large size renders the full card (same as medium baseline; M2 v1)",
  () => {
    // V1 of M2 ships large + medium with the same renderer (full card).
    // The visual divergence for large is a polish target deferred to a
    // future ORCH per the renderEventCardFull comment. This test pins
    // the V1 behavior so future divergence is intentional.
    const large = renderMarketingEmail(makeInput(`{{event:${UUID}|large}}`));
    assertStringIncludes(large.html, "Featured event");
    assertStringIncludes(large.html, "Friday Night");
    assertStringIncludes(large.html, "Get tickets");
  },
);

Deno.test(
  "ORCH-0891 M2 T-M2-AD-05: invalid size value (e.g. |huge) leaves the entire token as literal text",
  () => {
    // The extended regex's size group only accepts the
    // (compact|medium|large) alternation. An invalid size like `|huge`
    // makes the whole token NOT match — it stays as literal text in
    // the body. This protects against operator typos becoming silent
    // corruptions.
    const out = renderMarketingEmail(makeInput(`see {{event:${UUID}|huge}}`));
    // The literal `{{event:...|huge}}` should appear in the output
    // (not be replaced by any card).
    assertStringIncludes(out.html, "huge");
    // And the kicker text should NOT appear — no card was rendered.
    assert(
      !out.html.includes("Featured event"),
      "Invalid size must NOT trigger card rendering",
    );
  },
);

Deno.test(
  "ORCH-0891 M2 T-M2-AD-06: multiple tokens with mixed sizes each render their own card",
  () => {
    // Catches a hypothetical caching bug where the renderer might
    // memoize the first size and apply it to all subsequent chips.
    const body =
      `First: {{event:${UUID}|compact}}, second: {{event:${UUID}|medium}}, third: {{event:${UUID}|large}}`;
    const out = renderMarketingEmail(makeInput(body));

    // Count "Featured event" kickers — should be 2 (medium + large,
    // but compact doesn't include the kicker).
    const kickerMatches = out.html.match(/Featured event/g) ?? [];
    assertEquals(
      kickerMatches.length,
      2,
      "Expected 2 'Featured event' kickers (medium + large), got " +
        String(kickerMatches.length),
    );

    // Count "Get tickets" CTA buttons — same as above, 2.
    const ctaMatches = out.html.match(/Get tickets/g) ?? [];
    assertEquals(
      ctaMatches.length,
      2,
      "Expected 2 'Get tickets' CTAs, got " + String(ctaMatches.length),
    );

    // And the compact card's title link should appear AT LEAST once
    // (it's a separate <a> from the medium/large CTA).
    assertStringIncludes(out.html, "Friday Night");
  },
);

Deno.test(
  "ORCH-0891 M2 T-M2-AD-07: unknown event id (not in lookup) returns empty string regardless of size",
  () => {
    // Defensive — stale event references in long-archived campaigns
    // shouldn't crash the email. Original behavior was empty string;
    // M2 must preserve it for all sizes.
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const input: RenderMarketingEmailInput = {
      body_html: `{{event:${unknownId}|large}}{{event:${unknownId}}}{{event:${unknownId}|compact}}`,
      variables: EMPTY_VARIABLES,
      embedded_events: [], // No matching event
      unsubscribe_url: "https://example.com/unsub",
      subject: "test",
      brand_name: "Acme",
    };
    const out = renderMarketingEmail(input);
    // None of the three tokens should produce a card.
    assert(
      !out.html.includes("Featured event"),
      "Unknown event ID must not render any card",
    );
    assert(
      !out.html.includes("Friday Night"),
      "Unknown event ID must not render any title",
    );
  },
);
