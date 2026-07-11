// ORCH-1340 [card-real-avatars] — implementor-owned ADVERSARIAL guard suite
// (different angle than the happy-path orch_1340 suite): attacks the drift,
// duplication and dishonesty edges of I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-
// GATED — the naming-drift sweep (§4.5-d), the one-Pressable rule, the exact
// motion contract, the disk-geometry byte-parity, the host-supplied chip fill,
// and the "see-row never renders in the inert branch" structure.
//
// FAILS-ON-REVERT:
//   - resurrect the retired invariant name anywhere in the three components or
//     the momentum test → the drift sweep FAILS.
//   - add a second Pressable to the cluster (or any Pressable to
//     OfferingMomentum) → the one-Pressable assertions FAIL.
//   - change the fade contract (duration/driver/isInteraction) → motion FAILS.
//   - render the see-row in the inert (no-handler) branch → structure FAILS.
//   - inline a Platform switch for the chip fill inside the cluster → the
//     host-supplied chipFill assertions FAIL.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const CLUSTER_RAW = await read("../GuestAvatarCluster.tsx");
const RSVP_RAW = await read("../RsvpMomentumDecision.tsx");
const OM_RAW = await read("../OfferingMomentum.tsx");
const MOMENTUM_TEST_RAW = await read("./orch_1157_rsvp_momentum.test.ts");
const CLUSTER = strip(CLUSTER_RAW);
const OM = strip(OM_RAW);
const RSVP = strip(RSVP_RAW);

// ── §4.5-d — the naming-drift sweep (RAW sources: comments count as drift) ──

Deno.test("drift sweep: the retired invariant name survives NOWHERE in the components or the momentum test", () => {
  for (const [name, src] of [
    ["GuestAvatarCluster.tsx", CLUSTER_RAW],
    ["RsvpMomentumDecision.tsx", RSVP_RAW],
    ["OfferingMomentum.tsx", OM_RAW],
    ["orch_1157_rsvp_momentum.test.ts", MOMENTUM_TEST_RAW],
  ] as const) {
    assert(
      !/SOCIAL-PROOF-ANON-ONLY/.test(src),
      `${name}: the retired invariant name (either spelling) must not survive`,
    );
  }
  // The successor is cited where the retired name used to live.
  assertStringIncludes(RSVP_RAW, "I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED");
  assertStringIncludes(MOMENTUM_TEST_RAW, "I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED");
  // The surviving ADDRESS half is named (never silently dropped).
  assertStringIncludes(RSVP_RAW, "I-PROPOSED-1157-ADDRESS-PRIVACY");
});

// ── one-Pressable rule (the affordance is ONE group; cards stay pressless) ──

Deno.test("one Pressable: exactly one in the cluster; zero in OfferingMomentum; cluster renders once per card", () => {
  assertEquals(
    (CLUSTER.match(/<Pressable\b/g) ?? []).length,
    1,
    "GuestAvatarCluster carries exactly ONE Pressable (cluster+see-row group)",
  );
  assert(!/\bPressable\b/.test(OM), "OfferingMomentum itself stays pressless");
  assert(!/\bonPress\b/.test(OM), "OfferingMomentum itself wires no onPress");
  assert(!/\bTouchable/.test(OM), "no Touchable* in OfferingMomentum");
  assertEquals(
    (RSVP.match(/<GuestAvatarCluster\b/g) ?? []).length,
    1,
    "RsvpMomentumDecision renders the cluster exactly once (inside the D2 gate)",
  );
  assertEquals(
    (OM.match(/<GuestAvatarCluster\b/g) ?? []).length,
    1,
    "OfferingMomentum renders the cluster exactly once (inside the D2 gate)",
  );
});

// ── the inert branch: absent handler ⇒ NO see-row, NO button semantics ──────

Deno.test("inert branch: the no-handler return renders no see-row, no button, no label leak", () => {
  const branchStart = CLUSTER.indexOf("if (onSeeWhosGoing === undefined)");
  const pressableStart = CLUSTER.indexOf("<Pressable");
  assert(branchStart > -1, "the inert early-return exists");
  assert(pressableStart > branchStart, "the Pressable branch follows the inert branch");
  const inertBranch = CLUSTER.slice(branchStart, pressableStart);
  assert(!/See who's going/.test(inertBranch), "no see-row copy in the inert branch");
  assert(!/ChevronGlyph/.test(inertBranch), "no chevron in the inert branch");
  assert(
    !/accessibilityRole="button"/.test(inertBranch),
    "the inert cluster exposes no button to the a11y tree",
  );
  assertStringIncludes(inertBranch, "people going"); // today's plain-View label kept
});

// ── a11y group contract (pressable branch) ──────────────────────────────────

Deno.test("a11y: ONE button whose label carries everything; disks/note hidden from the tree", () => {
  assertStringIncludes(CLUSTER, 'accessibilityRole="button"');
  assertStringIncludes(CLUSTER, "going. See who's going");
  assertStringIncludes(CLUSTER, "accessibilityElementsHidden");
  assertStringIncludes(CLUSTER, 'importantForAccessibility="no-hide-descendants"');
  // Pressed feedback is the 0.7-opacity state (no scale — the card already
  // animates a meter + dot; DESIGN §1.7).
  assert(/pressed:\s*\{\s*opacity:\s*0\.7\s*\}/.test(CLUSTER));
  assert(!/transform.*scale/.test(CLUSTER), "no scale on press");
});

// ── the exact motion contract (DESIGN §1.7 / ORCH-1303) ─────────────────────

Deno.test("motion: photo fade is 160ms ease-out, native driver, isInteraction:false", () => {
  assertStringIncludes(CLUSTER, "duration: 160");
  assertStringIncludes(CLUSTER, "Easing.out(Easing.ease)");
  assertStringIncludes(CLUSTER, "useNativeDriver: true");
  assertStringIncludes(CLUSTER, "isInteraction: false");
  // The fade animates OPACITY only (zero layout shift by construction).
  assert(!/Animated\.timing[\s\S]{0,200}height/.test(CLUSTER), "fade never animates layout");
});

// ── disk geometry byte-parity + photo honesty ───────────────────────────────

Deno.test("disk geometry: today's cluster byte-parity (30×30 r999 b2, -8 overlap, overflow hidden)", () => {
  assertStringIncludes(CLUSTER, "width: 30");
  assertStringIncludes(CLUSTER, "height: 30");
  assertStringIncludes(CLUSTER, "borderRadius: 999");
  assertStringIncludes(CLUSTER, "borderWidth: 2");
  assertStringIncludes(CLUSTER, "marginLeft: first ? 0 : -8");
  assertStringIncludes(CLUSTER, 'overflow: "hidden"');
});

Deno.test("photo honesty: cover-fit photo above the glyph, hairline edge, no placeholder faces", () => {
  assertStringIncludes(CLUSTER, 'resizeMode="cover"');
  assertStringIncludes(CLUSTER, "StyleSheet.absoluteFillObject");
  // The hairline reads palette.panelBorder (edge definition on uncontrolled
  // photo content), 1px.
  assertStringIncludes(CLUSTER, "borderColor: palette.panelBorder");
  assertStringIncludes(CLUSTER, "borderWidth: 1");
  // Constitution #9 — no fabricated data: no bundled placeholder/fake avatar.
  assert(!/require\s*\(/.test(CLUSTER), "no bundled placeholder image");
  assert(!/placeholder|pravatar|unsplash|dicebear/i.test(CLUSTER), "no fake-face source");
});

// ── host-supplied chip fill (Android-opaque switch stays in the cards) ──────

Deno.test("chip fill is HOST-supplied: no Platform switch inside the cluster; both cards pass opaqueCardFill", () => {
  assertStringIncludes(CLUSTER, "chipFill: string");
  assertStringIncludes(CLUSTER, "backgroundColor: chipFill");
  assert(!/Platform\./.test(CLUSTER), "the Platform switch stays single-owned in the cards");
  assertStringIncludes(RSVP, "chipFill={opaqueCardFill(palette)}");
  assertStringIncludes(OM, "chipFill={opaqueCardFill(palette)}");
});

// ── sample plumbing: [] default; OM forwards the 1338 payload sample ────────

Deno.test("sample plumbing: guestSample defaults []; OfferingMomentum forwards socialProof.sample", () => {
  assertStringIncludes(CLUSTER, "guestSample = []");
  assertStringIncludes(RSVP, "guestSample = []");
  assertStringIncludes(OM, "guestSample={socialProof.sample}");
});
