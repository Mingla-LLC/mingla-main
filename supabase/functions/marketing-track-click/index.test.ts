// ORCH-0815-B — Source-introspection tests for marketing-track-click.
// Live integration verification owned by Claude `mingla-forensics` (TEST mode).

import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// T-B13 — 302 redirect with UTM params appended.
Deno.test("marketing-track-click: 302 redirect with UTM params (SPEC §7.2)", () => {
  assert(SOURCE.includes("status: 302"));
  assert(SOURCE.includes('"utm_source"'));
  assert(SOURCE.includes('"mingla"'));
  assert(SOURCE.includes('"utm_medium"'));
  assert(SOURCE.includes('"email"'));
  assert(SOURCE.includes('"utm_campaign"'));
  assert(SOURCE.includes('"utm_content"'));
});

// T-B14 — first-click vs subsequent semantics.
Deno.test("marketing-track-click: first-click captures clicked_at; subsequent only bump count", () => {
  assert(SOURCE.includes("clicked_at"));
  assert(/clicked_at === null/.test(SOURCE));
  assert(SOURCE.includes("click_count"));
  assert(/click_count\s*\?\?\s*0\)\s*\+\s*1/.test(SOURCE));
});

// Tracking-id shape validation.
Deno.test("marketing-track-click: tracking_id must match UUID regex (path-injection guard)", () => {
  assert(SOURCE.includes("TRACKING_ID_RE"));
  assert(SOURCE.includes("invalid_tracking_id"));
});

// User-agent + ip-hash capture for fraud analysis (Phase B+).
Deno.test("marketing-track-click: user_agent + ip_hash captured on the click row", () => {
  assert(SOURCE.includes("user-agent"));
  assert(SOURCE.includes("user_agent"));
  assert(SOURCE.includes("ip_hash"));
  assert(SOURCE.includes("x-forwarded-for"));
});

// Defensive: bad destination URL still 302s to fallback (emails never break).
Deno.test("marketing-track-click: malformed destination falls back to FALLBACK_URL", () => {
  assert(SOURCE.includes("FALLBACK_URL"));
  assert(SOURCE.includes("https://mingla.app"));
});

// Updates message row status transition (sent → clicked).
Deno.test("marketing-track-click: marketing_messages.status transitions to 'clicked' on first click", () => {
  assert(SOURCE.includes('"clicked"'));
  assert(SOURCE.includes("last_clicked_at"));
});

// #4273 tester — order safety: the click read must not name link_kind, or a
// deploy that lands before the migration adding it fails every click read and
// sends every email and SMS link to the fallback page.
Deno.test("marketing-track-click: the click read survives a missing link_kind column", () => {
  const read = SOURCE.slice(
    SOURCE.indexOf('.from("marketing_clicks")'),
    SOURCE.indexOf(".maybeSingle()"),
  );
  assert(read.includes('.select("*")'), read);
  assert(!read.includes("link_kind"), read);
  assert(SOURCE.includes('link_kind === "opt_out"'));
});
