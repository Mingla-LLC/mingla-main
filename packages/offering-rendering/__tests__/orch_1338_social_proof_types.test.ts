// ORCH-1338 [guest-read-backend] — T-12 package-purity regression test for
// socialProofTypes.ts (the FROZEN cross-leg payload contract consumed by
// ORCH-1339/1340/1341 as props).
//
// Pins I-MOR-0827-PACKAGE-ISOLATION for the new module: types + ONE constant
// only — no import statements, no fetch, no react, no app src/ dependency —
// and the exact five exported symbols + the constant value 5 (the RPC's
// sample LIMIT). Deno-runnable (the module is pure, dep-free — mirrors
// rsvpMomentum.ts / experienceAvailabilityBanner.ts test style).
//
// FAILS-ON-REVERT: deleting socialProofTypes.ts, renaming/dropping an export,
// changing SOCIAL_PROOF_SAMPLE_MAX, adding an import/fetch to the module, or
// dropping the barrel re-export makes this test FAIL.
//
// Run locally (repo root):
//   deno test --allow-read packages/offering-rendering/__tests__/orch_1338_social_proof_types.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { SOCIAL_PROOF_SAMPLE_MAX } from "../socialProofTypes.ts";
import type {
  PeerGuestListPage,
  PeerGuestRow,
  SocialProofEntityType,
  SocialProofSampleEntry,
  SocialProofSummary,
} from "../socialProofTypes.ts";

const source = await Deno.readTextFile(
  new URL("../socialProofTypes.ts", import.meta.url),
);
const barrel = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

/** The module's CODE with comments stripped (docs may NAME fetch/react while
 * forbidding them — the code itself must not contain the tokens). */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

Deno.test("T-12a module purity: no imports, no fetch, no react, no app src/", () => {
  assert(!/^\s*import\b/m.test(code), "no import statements (dep-free)");
  assert(!/\brequire\s*\(/.test(code), "no require()");
  assert(!/\bfetch\b/.test(code), "no fetch (props-only package — I-MOR-0827)");
  assert(!/\breact\b/i.test(code), "no react reference");
  assert(!/supabase/i.test(code), "no supabase client reference");
  assert(!/from\s+["']/.test(code), "no module dependency at all");
});

Deno.test("T-12b exports: the 5 frozen symbols + the constant, nothing missing", () => {
  assert(
    /export const SOCIAL_PROOF_SAMPLE_MAX = 5;/.test(source),
    "constant exported with literal value 5",
  );
  for (
    const symbol of [
      "SocialProofEntityType",
      "SocialProofSampleEntry",
      "SocialProofSummary",
      "PeerGuestRow",
      "PeerGuestListPage",
    ]
  ) {
    assert(
      new RegExp(`export type ${symbol}\\b`).test(source),
      `type ${symbol} exported`,
    );
  }
});

Deno.test("T-12c constant value: SOCIAL_PROOF_SAMPLE_MAX === 5 (RPC LIMIT parity)", () => {
  assertEquals(SOCIAL_PROOF_SAMPLE_MAX, 5);
});

Deno.test("T-12d shapes compile: RPC-payload-identical objects typecheck", () => {
  // Compile-time contract (deno test type-checks): the shapes below are the
  // exact camelCase payloads of pg_public_social_proof / peer_list_event_guests.
  const entity: SocialProofEntityType = "rsvp";
  const sampleEntry: SocialProofSampleEntry = {
    avatarUrl: "https://example.com/a.jpg",
    isMinglaUser: true,
  };
  const summary: SocialProofSummary = {
    eventId: "00000000-0000-0000-0000-000000000000",
    entityType: entity,
    goingCount: 4,
    capacity: null,
    privateGuestList: false,
    hideRemainingCount: false,
    sample: [sampleEntry],
  };
  const namedRow: PeerGuestRow = {
    profileId: "00000000-0000-0000-0000-000000000001",
    displayName: "A",
    username: "a",
    avatarUrl: null,
    // ORCH-1359 — location is NAMED-rows-only; present here.
    location: "London, England, United Kingdom",
    isMinglaUser: true,
    isAnonymous: false,
    partySize: 3,
  };
  const anonymousRow: PeerGuestRow = {
    profileId: null,
    displayName: null,
    username: null,
    avatarUrl: null,
    // ORCH-1359 — anonymous rows carry NULL location.
    location: null,
    isMinglaUser: false,
    isAnonymous: true,
    partySize: 1,
  };
  const page: PeerGuestListPage = {
    eventId: summary.eventId,
    entityType: "trip",
    returned: 2,
    hasMore: false,
    guests: [namedRow, anonymousRow],
  };
  assertEquals(page.guests.length, 2);
  assert(summary.sample.length <= SOCIAL_PROOF_SAMPLE_MAX);
});

Deno.test("T-12e barrel: index.ts re-exports the constant + all 5 types from ./socialProofTypes", () => {
  assert(
    /export \{ SOCIAL_PROOF_SAMPLE_MAX \} from "\.\/socialProofTypes";/.test(
      barrel,
    ),
    "constant re-exported",
  );
  const typeBlock = barrel.match(
    /export type \{([^}]*)\} from "\.\/socialProofTypes";/,
  );
  assert(typeBlock !== null, "type re-export block present");
  for (
    const symbol of [
      "SocialProofEntityType",
      "SocialProofSampleEntry",
      "SocialProofSummary",
      "PeerGuestRow",
      "PeerGuestListPage",
    ]
  ) {
    assert(typeBlock[1].includes(symbol), `barrel re-exports ${symbol}`);
  }
});
