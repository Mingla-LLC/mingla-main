// META-ORCH-1337 [social-proof-guest-list] — TESTER adversarial guard/privilege suite.
//
// Author: mingla-tester (TEST phase). NEW file (append-only safe).
//
// DIFFERENT ANGLE from every implementor suite:
//   • orch_1338_social_proof_reads.antiScrape.adversarial.test.ts pins that the
//     auth guard precedes GUEST-TABLE reads (event_rsvps/orders/tickets) and that
//     the FN-B grant excludes anon. It does NOT pin that the guard precedes the
//     EVENT-RESOLUTION read, does NOT scan for dynamic-SQL escalation vectors, and
//     does NOT touch the 1339 write migration at all.
//   • orch_1339_set_event_guest_privacy.test.ts pins the write RPC's jsonb_set leaf
//     PATHS (set-equality). It does NOT pin the ABSENCE of a destructive full-theme
//     overwrite, nor the guard-before-event-load ordering, nor a contact-data scan
//     of its own file.
//
// This suite attacks four angles NONE of the above cover:
//   (A) GUARD-TRULY-FIRST — the `authentication_required` RAISE precedes the very
//       first `FROM public.events` event-resolution read in BOTH FN-B and the write
//       RPC (an event-existence oracle before auth would leak private-event
//       existence to anon scrapers). Stronger than "precedes guest-table reads".
//   (B) DEFINER PRIVILEGE-ESCALATION — all three SECURITY DEFINER functions pin
//       `SET search_path = public` AND contain NO dynamic SQL (`EXECUTE '…'` /
//       `EXECUTE format(`). A DEFINER function with dynamic SQL or a mutable
//       search_path is the classic privilege-escalation / injection vector.
//   (C) NO-CLOBBER DESTRUCTIVE-WRITE — the 1339 write RPC never assigns `theme`
//       from a fresh object literal / `jsonb_build_object` (a full overwrite that
//       would wipe sibling keys such as hideAddressUntilTicket — proven survivable
//       by live-fire at TEST); the only UPDATE assigns `theme = v_theme`.
//   (D) CONTACT-DATA SCAN of the 1339 file — no guest_*/buyer_*/attendee_* token
//       appears in the write migration either (the 1338 suite scans only its own).
//
// WHY the runtime layer matters (TEST live-fire finding, 2026-07-10): on prod
// `gqnoajqerqhnvulmnyvv` anon RETAINS EXECUTE on peer_list_event_guests +
// biz_set_event_guest_privacy (Supabase ALTER DEFAULT PRIVILEGES grants anon on
// CREATE; `REVOKE ALL FROM PUBLIC` does not strip the ROLE grant). The in-function
// `authentication_required` guard is therefore the ONLY real barrier — so its
// GUARD-FIRST position (angle A) is load-bearing, not merely defensive.
//
// FAILS-ON-REVERT: moving either RAISE after the event load, adding a dynamic
// EXECUTE, replacing the leaf write with a `theme = jsonb_build_object(...)`
// overwrite, dropping a SET search_path, or leaking a contact token → this suite
// FAILS. Restoring → PASS.
//
// Run (repo root):
//   deno test --allow-read supabase/migrations/__tests__/orch_1337_guard_first_privilege.tester.adversarial.test.ts

import { assert } from "jsr:@std/assert@1";

const READ_MIG =
  "supabase/migrations/20261225000000_orch_1338_social_proof_guest_reads.sql";
const WRITE_MIG =
  "supabase/migrations/20261226000000_orch_1339_set_event_guest_privacy.sql";

const readMig = await Deno.readTextFile(READ_MIG);
const writeMig = await Deno.readTextFile(WRITE_MIG);

function fnBody(src: string, name: string): string {
  const m = src.match(
    new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`),
  );
  assert(m !== null, `function body found for ${name}`);
  return m![0];
}

const fnB = fnBody(readMig, "peer_list_event_guests");
const fnWrite = fnBody(writeMig, "biz_set_event_guest_privacy");

// (A) — GUARD-TRULY-FIRST: auth RAISE precedes the FIRST event-resolution read.
Deno.test("A1 FN-B: authentication_required precedes the FROM public.events event resolution", () => {
  const idxAuth = fnB.indexOf("RAISE EXCEPTION 'authentication_required'");
  const idxEventLoad = fnB.indexOf("FROM public.events");
  assert(idxAuth >= 0, "FN-B has an auth RAISE");
  assert(idxEventLoad >= 0, "FN-B resolves the event via FROM public.events");
  assert(
    idxAuth < idxEventLoad,
    "auth guard must fire BEFORE the event even exists in scope (no existence oracle to anon)",
  );
});

Deno.test("A2 write RPC: authentication_required precedes the FROM public.events event load", () => {
  const idxAuth = fnWrite.indexOf("RAISE EXCEPTION 'authentication_required'");
  const idxEventLoad = fnWrite.indexOf("FROM public.events");
  const idxNotAuthorized = fnWrite.indexOf("RAISE EXCEPTION 'not_authorized'");
  const idxUpdate = fnWrite.indexOf("UPDATE public.events");
  assert(idxAuth >= 0 && idxEventLoad >= 0, "auth guard + event load present");
  assert(idxAuth < idxEventLoad, "auth guard precedes the event load");
  assert(
    idxNotAuthorized >= 0 && idxNotAuthorized < idxUpdate,
    "host gate (not_authorized) precedes the UPDATE write",
  );
});

// (B) — DEFINER PRIVILEGE-ESCALATION: pinned search_path + zero dynamic SQL.
Deno.test("B1 all three DEFINER functions pin search_path = public", () => {
  const fnA = fnBody(readMig, "pg_public_social_proof");
  for (const [label, body] of [["FN-A", fnA], ["FN-B", fnB], ["write", fnWrite]]) {
    assert(
      /SECURITY DEFINER\s+SET search_path = public\b/.test(body),
      `${label} must be SECURITY DEFINER with a pinned search_path (escalation guard)`,
    );
  }
});

Deno.test("B2 no dynamic SQL in any DEFINER body (injection/escalation vector)", () => {
  for (const [label, src] of [["read mig", readMig], ["write mig", writeMig]]) {
    assert(
      !/EXECUTE\s+'|EXECUTE\s+format\s*\(|EXECUTE\s+v_|EXECUTE\s+"/.test(src),
      `${label} must contain NO dynamic EXECUTE — a DEFINER function running dynamic SQL is a privilege-escalation vector`,
    );
  }
});

// (C) — NO-CLOBBER DESTRUCTIVE-WRITE: the write RPC never full-overwrites theme.
Deno.test("C1 write RPC: theme is written ONLY from the jsonb_set-chained v_theme, never a fresh object", () => {
  // The single UPDATE must assign theme = v_theme (the leaf-merged accumulator).
  assert(
    /UPDATE public\.events\s+SET theme = v_theme\b/.test(fnWrite),
    "the UPDATE assigns theme = v_theme (leaf-merge accumulator)",
  );
  // No destructive full-overwrite: theme is never assigned a fresh object literal
  // or a jsonb_build_object(...) in an UPDATE/SET position.
  assert(
    !/SET theme = '\{/.test(fnWrite),
    "theme is never SET to a bare object literal (would wipe sibling keys)",
  );
  assert(
    !/SET theme = jsonb_build_object/.test(fnWrite),
    "theme is never SET to a freshly-built object (would wipe hideAddressUntilTicket etc.)",
  );
  // Exactly the two owned leaf keys are jsonb_set into settings — nothing else.
  assert(
    fnWrite.includes("jsonb_set(v_settings, '{privateGuestList}'") &&
      fnWrite.includes("jsonb_set(v_settings, '{hideRemainingCount}'"),
    "both owned leaf keys are jsonb_set into the settings accumulator",
  );
});

Deno.test("C2 write RPC: exactly one UPDATE, targeting events by primary key", () => {
  const updates = fnWrite.match(/UPDATE public\.events/g) ?? [];
  assert(updates.length === 1, "exactly one UPDATE (no second hidden write)");
  assert(
    /WHERE id = p_event_id/.test(fnWrite),
    "the write is keyed by the event PK only",
  );
});

// (D) — CONTACT-DATA SCAN of the 1339 write migration (the 1338 suite skips it).
Deno.test("D1 write migration: zero typed-contact-data tokens anywhere", () => {
  assert(
    !/guest_email|guest_phone|guest_name|buyer_name|buyer_email|buyer_phone|attendee_/
      .test(writeMig),
    "no guest_*/buyer-contact/attendee_* token in the write migration (code or comment)",
  );
});

// (D2) — the write RPC is authenticated-only in source AND host-gated in body
// (the grant layer alone is NOT the barrier — see the TEST live-fire finding).
Deno.test("D2 write RPC grant excludes anon AND the body carries the host gate", () => {
  const grant = writeMig.match(
    /GRANT EXECUTE ON FUNCTION public\.biz_set_event_guest_privacy\([^)]*\) TO ([^;]+);/,
  );
  assert(grant !== null, "write RPC has a GRANT");
  assert(!/\banon\b/.test(grant![1]), "no anon in the write grant");
  assert(
    /biz_brand_effective_rank\([^)]*\)\s*<\s*public\.biz_role_rank\('event_manager'/
      .test(fnWrite),
    "host gate uses the event_manager rank predicate (the guard the runtime relies on)",
  );
});
