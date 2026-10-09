// #3682 Wave 2.3 — blast Follow CTA on email render + SMS append.
// Run: deno test supabase/functions/_shared/__tests__/issue_3682_blast_follow_cta.happy.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  appendSmsFollowLine,
  brandFollowPublicUrl,
  renderBlastFollowPanelHtml,
  smsBlastBodyWithFollow,
} from "../marketingBlastFollow.ts";
import { marketingBookSmsWireBody } from "../marketingBookQuote.ts";
import { computeSegments } from "../adapters/smsAdapter.ts";
import {
  renderMarketingEmail,
  type MarketingVariables,
  type RenderMarketingEmailInput,
} from "../marketingEmailRender.ts";

const EMPTY_VARIABLES: MarketingVariables = {
  first_name: "Maya",
  event_name: null,
  event_date: null,
  event_date_short: null,
  event_time: null,
  doors_open: null,
  ends_at: null,
  brand_name: "Lantern Room",
  event_url: null,
  spots_left: null,
  previous_event_name: null,
  next_event_name: null,
  event_id: null,
};

function makeInput(
  overrides: Partial<RenderMarketingEmailInput> = {},
): RenderMarketingEmailInput {
  return {
    body_html: "Doors at nine.",
    variables: EMPTY_VARIABLES,
    embedded_events: [],
    unsubscribe_url: "https://example.com/unsub",
    subject: "Friday",
    brand_name: "Lantern Room",
    ...overrides,
  };
}

Deno.test("#3682 happy: brandFollowPublicUrl carries intent=follow", () => {
  assertEquals(
    brandFollowPublicUrl("lantern-room"),
    "https://host.usemingla.com/b/lantern-room?intent=follow",
  );
});

Deno.test("#3682 happy: renderBlastFollowPanelHtml escapes brand name", () => {
  const html = renderBlastFollowPanelHtml(
    '<Acme>',
    "https://host.usemingla.com/b/acme?intent=follow",
  );
  assertStringIncludes(html, "data-mingla-blast-follow");
  assertStringIncludes(html, "Follow &lt;Acme&gt; on Mingla");
  assert(!html.includes("<Acme>"));
});

Deno.test("#3682 happy: renderMarketingEmail injects Follow panel + tracks link", () => {
  const followUrl = brandFollowPublicUrl("lantern-room");
  const out = renderMarketingEmail(
    makeInput({ brand_follow_url: followUrl }),
  );
  assertStringIncludes(out.html, "data-mingla-blast-follow");
  assertStringIncludes(out.html, "Follow Lantern Room");
  assertStringIncludes(out.text, `Follow Lantern Room: ${followUrl}`);
  assert(
    out.links.some((link) => link.destination_url === followUrl),
    "Follow destination must be in marketing_clicks rewrite list",
  );
});

Deno.test("#3682 happy: without brand_follow_url no Follow panel", () => {
  const out = renderMarketingEmail(makeInput());
  assert(!out.html.includes("data-mingla-blast-follow"));
});

Deno.test("#3682 happy: appendSmsFollowLine is idempotent", () => {
  const url = brandFollowPublicUrl("acme");
  const once = appendSmsFollowLine("Hi", "Acme", url);
  assertStringIncludes(once, "Follow Acme:");
  assertEquals(appendSmsFollowLine(once, "Acme", url), once);
});

Deno.test("#3682 happy: smsBlastBodyWithFollow corpus (shared with client Jest)", () => {
  assertEquals(
    smsBlastBodyWithFollow("Hi", "Acme", "acme"),
    "Hi\n\nFollow Acme: https://host.usemingla.com/b/acme?intent=follow",
  );
  assertEquals(smsBlastBodyWithFollow("Hi", "Acme", null), "Hi");
  assertEquals(smsBlastBodyWithFollow("Hi", "Acme", ""), "Hi");
});

Deno.test("#3682 happy: marketing-send wires brand_follow_url + SMS append", () => {
  const sendSrc = Deno.readTextFileSync(
    new URL("../../marketing-send/index.ts", import.meta.url),
  );
  assert(sendSrc.includes("brand_follow_url: brandFollowUrl"));
  assert(sendSrc.includes("smsBlastBodyWithFollow"));
  assert(sendSrc.includes("brandFollowPublicUrl"));
  assert(sendSrc.includes("followBrand"));
});

Deno.test("#3682 happy: client blastFollow.ts stays byte-identical to edge helpers", () => {
  // Cross-runtime import is not viable (Jest vs Deno); lock the pure helpers
  // by comparing the shared function bodies so a future copy drift fails CI.
  const edgeSrc = Deno.readTextFileSync(
    new URL("../marketingBlastFollow.ts", import.meta.url),
  );
  const clientSrc = Deno.readTextFileSync(
    new URL(
      "../../../../mingla-business/src/utils/marketing/blastFollow.ts",
      import.meta.url,
    ),
  );
  const extract = (src: string, name: string): string => {
    const re = new RegExp(
      `export function ${name}\\([\\s\\S]*?\\n\\}\\n`,
    );
    const match = src.match(re);
    assert(match !== null, `missing export function ${name}`);
    return match[0];
  };
  for (const name of [
    "brandFollowPublicUrl",
    "appendSmsFollowLine",
    "smsBlastBodyWithFollow",
  ]) {
    assertEquals(extract(clientSrc, name), extract(edgeSrc, name));
  }
});

Deno.test("#3682 happy: quote and dispatch share Follow owner — segment boundary", () => {
  // Author body sized so STOP footer alone stays 1 segment, but Follow + STOP
  // crosses into 2 — pricing must see the Follow bytes (Copilot).
  const raw = "A".repeat(120);
  const withFollow = smsBlastBodyWithFollow(raw, "Acme", "acme");
  const origin = "https://usemingla.com/m";
  const wireWithout = marketingBookSmsWireBody(raw, origin);
  const wireWith = marketingBookSmsWireBody(withFollow, origin);
  assertEquals(computeSegments(wireWithout), 1);
  assert(
    computeSegments(wireWith) >= 2,
    "Follow line must bump segments at the boundary",
  );
  assertEquals(smsBlastBodyWithFollow(withFollow, "Acme", "acme"), withFollow);
});
