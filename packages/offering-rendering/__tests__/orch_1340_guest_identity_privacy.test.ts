// ORCH-1340 [card-real-avatars] — implementor-owned happy-path guard suite for
// the successor invariant I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED
// (SPEC §4.6 items 1–8; supersedes the anon-cluster half of the retired
// I-PROPOSED-1157 social-proof invariant — the ADDRESS-privacy half survives
// verbatim as I-PROPOSED-1157-ADDRESS-PRIVACY, untouched by this leg).
//
// Deno-runnable source-structure suite in the 1157/1163 house style (read the
// component files → strip comments → assert): the package ships no
// react-native renderer, so the invariant is enforced structurally; the
// tester's runtime passes (screenshots, tap-proofs) sit on top.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - strip the onError fallback from GuestAvatarCluster → fallback-honesty FAILS.
//   - add a name-bearing prop (username / displayName?:) to any of the three
//     components → the identity wall FAILS.
//   - move <Image> into a card file (or add a fetch to the package) → the
//     single-photo-owner / no-fetch assertions FAIL.
//   - re-inline a no-op onSeeWhosGoing default → affordance integrity FAILS.
//   - hex literal in GuestAvatarCluster → the theme-dial extension FAILS.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

// Strip /* */ block comments, // line comments and {/* JSX */} nodes before
// token bans — the invariants are about RENDERED code; doc comments
// legitimately NAME the forbidden things to explain WHY they are absent.
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const CLUSTER_RAW = await read("../GuestAvatarCluster.tsx");
const RSVP_RAW = await read("../RsvpMomentumDecision.tsx");
const OM_RAW = await read("../OfferingMomentum.tsx");
const CLUSTER = strip(CLUSTER_RAW);
const RSVP = strip(RSVP_RAW);
const OM = strip(OM_RAW);

const ALL_THREE: ReadonlyArray<readonly [string, string]> = [
  ["GuestAvatarCluster", CLUSTER],
  ["RsvpMomentumDecision", RSVP],
  ["OfferingMomentum", OM],
];

// ── §4.6-1 — the identity wall ──────────────────────────────────────────────

Deno.test("identity wall: no guest name/photo-of-record/username field in any of the three components", () => {
  for (const [name, src] of ALL_THREE) {
    assert(
      !/guestName|guestPhoto|attendeeName|guestAvatar/.test(src),
      `${name}: no guest identity fields`,
    );
    assert(!/\busername\b/.test(src), `${name}: no username token`);
    // The DECLARATION form only — React's `Component.displayName = "…"`
    // assignment is legitimate and deliberately excluded by shape.
    assert(
      !/\bdisplayName\s*\??\s*:/.test(src),
      `${name}: no name-bearing prop declaration`,
    );
    assert(!/maybeCount|waitlistCount/.test(src), `${name}: no maybe/waitlist counts`);
  }
});

Deno.test("identity wall: the cluster consumes ONLY the 1338 frozen sample shape (cannot carry names)", () => {
  assertStringIncludes(CLUSTER, 'from "./socialProofTypes"');
  assertStringIncludes(CLUSTER, "SocialProofSampleEntry");
  // Disk i renders sample[i] (photos lead, glyphs trail — server order); no
  // client re-sort, no identity lookup.
  assertStringIncludes(CLUSTER, "guestSample[i]?.avatarUrl");
});

// ── §4.6-2 — single photo owner ─────────────────────────────────────────────

Deno.test("single photo owner: <Image>/uri live in GuestAvatarCluster ONLY", () => {
  assert(/<Image\b/.test(CLUSTER), "the cluster renders the photo <Image>");
  assert(/\buri\b/.test(CLUSTER), "the cluster owns the uri source");
  for (const [name, src] of [ALL_THREE[1], ALL_THREE[2]] as const) {
    assert(!/<Image\b/.test(src), `${name}: no <Image> — photos live in the cluster only`);
    assert(!/\buri\b/.test(src), `${name}: no uri — photos live in the cluster only`);
  }
  // Both cards render their cluster exclusively through the shared component.
  assertStringIncludes(RSVP, 'from "./GuestAvatarCluster"');
  assertStringIncludes(RSVP, "<GuestAvatarCluster");
  assertStringIncludes(OM, 'from "./GuestAvatarCluster"');
  assertStringIncludes(OM, "<GuestAvatarCluster");
});

// ── §4.6-3 — fallback honesty + the indistinguishability clause (D1 visual) ─

Deno.test("fallback honesty: onError → glyph permanently; ONE glyph-disk treatment; no private marker", () => {
  assertStringIncludes(CLUSTER, "onError");
  assertStringIncludes(CLUSTER, "PersonGlyph");
  // Exactly ONE glyph-disk fill — a second "private-style" disk (dim/marker)
  // would leak the one bit a private guest chose to hide.
  const glyphFills = CLUSTER.match(/backgroundColor: palette\.accent/g) ?? [];
  assert(
    glyphFills.length === 1,
    `exactly one glyph-disk fill expected, found ${glyphFills.length}`,
  );
  assert(!/\block\b/i.test(CLUSTER), "no lock token — private guests are unmarked");
  assert(!/\bbadge\b/i.test(CLUSTER), "no badge token — private guests are unmarked");
  assert(!/\bdimmed?\b/i.test(CLUSTER), "no dim treatment — private guests are unmarked");
});

// ── §4.6-4 — motion discipline (ORCH-1303 class, extended to the new file) ──

Deno.test("motion discipline: any Animated in the cluster carries isInteraction:false", () => {
  if (/\bAnimated\./.test(CLUSTER)) {
    assert(
      /isInteraction: false/.test(CLUSTER),
      "every Animated timing in GuestAvatarCluster must carry isInteraction:false",
    );
  }
});

// ── §4.6-5 — affordance integrity (no dead taps; D2 covers the affordance) ──

Deno.test("affordance integrity: optional onSeeWhosGoing, no no-op fallback, see-row only with handler", () => {
  for (const [name, src] of ALL_THREE) {
    assertStringIncludes(src, "onSeeWhosGoing?: () => void", `${name} prop is optional`);
    assert(
      !/onSeeWhosGoing\s*=\s*\(\)\s*=>/.test(src),
      `${name}: NO no-op handler fallback — absent handler must mean non-pressable`,
    );
  }
  assertStringIncludes(CLUSTER, "See who's going");
  // Absent handler ⇒ the non-pressable early return (inert cluster, no seeRow).
  assertStringIncludes(CLUSTER, "if (onSeeWhosGoing === undefined)");
});

Deno.test("D2 gates: privateGuestList suppresses the WHOLE cluster block (affordance included) in both cards", () => {
  assertStringIncludes(RSVP, "momentum.hasGoing && !privateGuestList ?");
  assert(/\{!socialProof\.privateGuestList \? \(/.test(OM));
});

// ── §4.6-6 — theme-dial extension over the new file ─────────────────────────

Deno.test("theme dial: no hex in GuestAvatarCluster; primaryText link label; accent chevron", () => {
  assert(!/#[0-9a-fA-F]{6}\b/.test(CLUSTER), "no 6-digit hex literal");
  assert(!/#[0-9a-fA-F]{3}\b/.test(CLUSTER), "no 3-digit hex literal");
  // The see-row label is palette.primaryText (13px is below the WCAG large-text
  // threshold; accent only guarantees 3.15:1 vs the page — DESIGN §1.4).
  assertStringIncludes(CLUSTER, "color: palette.primaryText");
  // The accent rides the chevron — a ≥3:1 UI mark, not text.
  assertStringIncludes(CLUSTER, "ChevronGlyph color={palette.accent}");
});

// ── §4.6-8 — no checkout affordance, no fetch (I-MOR-0827) ──────────────────

Deno.test("no checkout / no fetch: the cluster is pure presentation", () => {
  assert(!/\/checkout/.test(CLUSTER));
  assert(!/priceAllIn/.test(CLUSTER));
  assert(!/\bReserve\b/.test(CLUSTER));
  assert(!/Get tickets/.test(CLUSTER));
  assert(!/\bcart\b/i.test(CLUSTER));
  assert(!/supabase/i.test(CLUSTER), "no backend client in the package");
  assert(!/\bfetch\s*\(/.test(CLUSTER), "no fetch in the package (I-MOR-0827)");
});
