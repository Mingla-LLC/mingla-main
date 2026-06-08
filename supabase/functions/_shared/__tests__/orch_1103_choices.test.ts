// ORCH-1103 REWORK 2 — agent-side choices payload (Surfaces 3 & 5).
//
// The dead-tap audit found "which brand?" disambiguation and the no-brand
// handoff were never wired. This locks the AGENT side: detectChoices emits the
// presentational payload that the client renders as QuickReplyChips. It is
// purely presentational — tapping a chip sends its label as a normal user turn
// (Q2); it does NOT touch the tool-confirm contract.
//
// fails-on-revert: on pre-REWORK-2 source the _shared/agentChoices.ts module
// does not exist (import fails) and agent-chat never attaches a choices payload.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectChoices } from "../agentChoices.ts";
import type { BrandSummary } from "../agentSystemPrompt.ts";

function brand(id: string, name: string): BrandSummary {
  return { id, name, slug: name.toLowerCase(), defaultCurrency: "USD", hasCover: false, hasBlockingEvents: false };
}

const TWO_BRANDS = [brand("b1", "Lumen Coffee"), brand("b2", "Night Owl Bar")];

Deno.test("detectChoices: edit intent + 2 brands + Ari asks → brand_disambiguation chips", () => {
  const c = detectChoices("edit my brand", "Sure — which brand do you mean?", TWO_BRANDS);
  assert(c, "expected a choices payload");
  assertEquals(c!.kind, "brand_disambiguation");
  assertEquals(c!.options.length, 2);
  assertEquals(c!.options[0], { id: "b1", label: "Lumen Coffee" });
  assertEquals(c!.options[1], { id: "b2", label: "Night Owl Bar" });
});

Deno.test("detectChoices: delete intent disambiguation also triggers", () => {
  const c = detectChoices("delete a brand", "Which brand should I delete?", TWO_BRANDS);
  assert(c);
  assertEquals(c!.kind, "brand_disambiguation");
});

Deno.test("detectChoices: NO chips when Ari isn't asking (flat statement)", () => {
  // No question mark → Ari resolved it itself / made a statement → no chips.
  const c = detectChoices("edit my brand", "I renamed Lumen Coffee for you.", TWO_BRANDS);
  assertEquals(c, undefined);
});

Deno.test("detectChoices: NO chips with a single brand (nothing to disambiguate)", () => {
  const c = detectChoices("edit my brand", "Which brand?", [brand("b1", "Lumen Coffee")]);
  assertEquals(c, undefined);
});

Deno.test("detectChoices: 0 brands + event-create intent → no_brand_handoff yes/no", () => {
  const c = detectChoices("create an event for Friday", "You'll need a brand first. Want me to set one up?", []);
  assert(c);
  assertEquals(c!.kind, "no_brand_handoff");
  assertEquals(c!.options.map((o) => o.label), ["Yes, create a brand", "Not now"]);
});

Deno.test("detectChoices: handoff triggers for experience/trip object words too", () => {
  assert(detectChoices("set up a trip", "You need a brand first — create one?", []));
  assert(detectChoices("host an experience", "You need a brand first — create one?", []));
});

Deno.test("detectChoices: NO handoff when the user already has a brand", () => {
  const c = detectChoices("create an event", "Sure, which brand?", TWO_BRANDS);
  // This has a brand, so it's not the no-brand handoff. (And no edit/delete
  // intent, so not disambiguation either.) → no chips.
  assertEquals(c, undefined);
});

Deno.test("detectChoices: disambiguation caps at 8 chips", () => {
  const many = Array.from({ length: 12 }, (_, i) => brand(`b${i}`, `Brand ${i}`));
  const c = detectChoices("rename my brand", "Which one?", many);
  assert(c);
  assertEquals(c!.options.length, 8);
});
