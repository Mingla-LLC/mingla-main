/**
 * ISSUE-927 — the three QA-867-WP5 one-liners, each pinned (F-1 / F-2 / F-4).
 *
 *   F-1 (P2): SNAPCHAT_CREATIVE_TO_AD_TYPE lookup failed OPEN on
 *       prototype-chain keys — snapchatAdTypeForCreativeType("toString")
 *       returned Object.prototype.toString (truthy), JSON.stringify elided
 *       the function value and the ad body went onto the wire TYPELESS,
 *       delegating the ad type to Snap (the exact S-2 forbidden default).
 *       Fixed with Object.hasOwn — prototype keys now throw
 *       creative_type_unmapped.
 *
 *   F-2 (P2): validateSnapchatCta("toString", …) crashed with a raw
 *       TypeError (allowlist.includes is not a function) instead of the S-3
 *       clean 422. Fixed with Object.hasOwn — prototype keys now return
 *       { ok:false, detail:"invalid_cta" } and never throw.
 *
 *   F-4 (P3): Snap's read-back adds a server-owned legacy `objective` key we
 *       never send (S-6 deprecated); the RMW PUT echoed it back. Now on
 *       SNAPCHAT_READ_ONLY_ENTITY_FIELDS so snapchatStripReadOnlyFields
 *       removes it before every PUT.
 *
 * Run: deno test supabase/functions/_shared/__tests__/issue927_wp5_hasown_guards.test.ts
 */

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { AdApiError } from "../adChannel.ts";
import {
  SNAPCHAT_READ_ONLY_ENTITY_FIELDS,
  snapchatAdTypeForCreativeType,
  snapchatStripReadOnlyFields,
  validateSnapchatCta,
} from "../snapchat.ts";

const PROTOTYPE_KEYS = ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"];

// ── F-1: creative-type → ad-type map fails CLOSED on prototype-chain keys ─────

Deno.test("927 F-1: prototype-chain creative types throw creative_type_unmapped (never a function, never SNAP_AD delegation)", () => {
  for (const key of PROTOTYPE_KEYS) {
    const err = assertThrows(
      () => snapchatAdTypeForCreativeType(key),
      AdApiError,
      undefined,
      `"${key}" must fail closed`,
    ) as AdApiError;
    assertEquals(err.code, "creative_type_unmapped", `"${key}" → creative_type_unmapped`);
  }
});

Deno.test("927 F-1: real own keys still map (WEB_VIEW → REMOTE_WEBPAGE — the S-2 contract)", () => {
  assertEquals(snapchatAdTypeForCreativeType("WEB_VIEW"), "REMOTE_WEBPAGE");
});

// ── F-2: CTA validator returns a clean invalid_cta on prototype keys ──────────

Deno.test("927 F-2: prototype-chain creative types return {ok:false, invalid_cta} — never a TypeError", () => {
  for (const key of PROTOTYPE_KEYS) {
    // The bug class was an unhandled THROW → 500; assert it RETURNS.
    const result = validateSnapchatCta(key, "BOOK_NOW");
    assertEquals(result.ok, false, `"${key}" must fail closed`);
    if (!result.ok) assertEquals(result.detail, "invalid_cta");
  }
});

Deno.test("927 F-2: the WEB_VIEW allowlist still validates (BOOK_NOW ok; VIEW_MORE rejected)", () => {
  assertEquals(validateSnapchatCta("WEB_VIEW", "BOOK_NOW").ok, true);
  const bad = validateSnapchatCta("WEB_VIEW", "VIEW_MORE");
  assertEquals(bad.ok, false);
  if (!bad.ok) assertEquals(bad.detail, "invalid_cta");
});

// ── F-4: the server-echoed legacy `objective` key is on the strip list ────────

Deno.test("927 F-4: `objective` is stripped before the read-modify-write PUT", () => {
  assert(
    SNAPCHAT_READ_ONLY_ENTITY_FIELDS.includes("objective"),
    "SNAPCHAT_READ_ONLY_ENTITY_FIELDS must carry the legacy `objective` echo (S-6)",
  );
  const stripped = snapchatStripReadOnlyFields({
    id: "11111111-2222-4333-8444-555555555555",
    name: "Friday Live",
    objective: "TRAFFIC", // server-added legacy echo — never ours
    objective_v2_type: "TRAFFIC", // the S-1 field we DO own — must survive
    status: "PAUSED",
    created_at: "2026-07-16T00:00:00Z",
  });
  assertEquals("objective" in stripped, false, "legacy objective must not survive the strip");
  assertEquals(stripped.objective_v2_type, "TRAFFIC", "objective_v2_type is ours and must survive");
  assertEquals(stripped.name, "Friday Live");
  assertEquals("created_at" in stripped, false);
});
