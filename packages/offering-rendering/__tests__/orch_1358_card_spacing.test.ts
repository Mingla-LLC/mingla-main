// ORCH-1358 [social-proof-card-spacing] — implementor-owned happy-path
// regression suite (SPEC §5 SC-1/SC-2/SC-4, §9 fails-on-revert).
//
// The "See who's going" momentum card rendered flush against the vibe/taxonomy
// pill cluster (screenshot "FIFA Grill Night"): the shared card style carries
// marginBottom:16 but no marginTop, and the pill rows carry no marginBottom, so
// the card's top border abutted the pills. The fix adds marginTop:16 to the
// shared `momentum` style in BOTH byte-parity twins (OfferingMomentum reaches
// event/trip/experience + buyer-web + business-preview automatically;
// RsvpMomentumDecision is the RSVP card). This suite is Deno-runnable in the
// 1339/1340 package house style (read the source → assert the compiled style
// block), because the package ships no react-native renderer.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - delete `marginTop: 16` from OfferingMomentum.momentum → T-1 FAILS.
//   - delete `marginTop: 16` from RsvpMomentumDecision.momentum → T-2 FAILS.
//   - the byte-parity + no-regression guards (T-3) fail if the two cards drift
//     or if marginBottom:16 / padding:18 are disturbed.
//
// Run locally (repo root):
//   deno test --allow-read packages/offering-rendering/__tests__/orch_1358_card_spacing.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const OM = await read("../OfferingMomentum.tsx");
const RSVP = await read("../RsvpMomentumDecision.tsx");

/** Extract the `momentum: { … },` StyleSheet block from a component source. */
function momentumBlock(src: string, label: string): string {
  const m = src.match(/momentum:\s*\{[\s\S]*?\n\s*\},/);
  assert(m !== null, `${label}: momentum style block found`);
  return m[0];
}

const OM_BLOCK = momentumBlock(OM, "OfferingMomentum");
const RSVP_BLOCK = momentumBlock(RSVP, "RsvpMomentumDecision");

// ── T-1 — OfferingMomentum card carries the top gap ─────────────────────────

Deno.test("T-1 OfferingMomentum.momentum has marginTop: 16 (top breathing room)", () => {
  assert(
    /\bmarginTop:\s*16\b/.test(OM_BLOCK),
    "OfferingMomentum.momentum must declare marginTop: 16",
  );
});

// ── T-2 — RSVP card parity (byte-parity twin) ───────────────────────────────

Deno.test("T-2 RsvpMomentumDecision.momentum has marginTop: 16 (byte-parity twin)", () => {
  assert(
    /\bmarginTop:\s*16\b/.test(RSVP_BLOCK),
    "RsvpMomentumDecision.momentum must declare marginTop: 16",
  );
});

// ── T-3 — no regression to the existing spacing + the two twins stay aligned ─

Deno.test("T-3 marginBottom:16 + padding:18 unchanged on both cards (no regression)", () => {
  for (const [label, block] of [
    ["OfferingMomentum", OM_BLOCK],
    ["RsvpMomentumDecision", RSVP_BLOCK],
  ] as const) {
    assert(/\bmarginBottom:\s*16\b/.test(block), `${label}: marginBottom stays 16`);
    assert(/\bpadding:\s*18\b/.test(block), `${label}: padding stays 18`);
    assert(/\bborderRadius:\s*20\b/.test(block), `${label}: borderRadius stays 20`);
    assert(/\bborderWidth:\s*1\b/.test(block), `${label}: borderWidth stays 1`);
  }
});

Deno.test("T-3b both cards carry the SAME top+bottom gap (symmetric 16 rhythm)", () => {
  const omTop = OM_BLOCK.match(/\bmarginTop:\s*(\d+)\b/)?.[1];
  const rsvpTop = RSVP_BLOCK.match(/\bmarginTop:\s*(\d+)\b/)?.[1];
  assertEquals(omTop, "16", "OfferingMomentum marginTop is 16");
  assertEquals(rsvpTop, omTop, "RSVP card mirrors the shared card's marginTop");
});
