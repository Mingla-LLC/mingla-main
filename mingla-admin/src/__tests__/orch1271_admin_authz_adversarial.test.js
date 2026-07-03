// ORCH-1271 [Admin authorization & audit FOUNDATION] — TESTER ADVERSARIAL suite.
//
// Different angle than the implementor happy-path
// (orch1271_admin_authz_foundation.test.js, which proves the seam is wired +
// guards-first). This suite attacks the AUDIT-INTEGRITY invariants the tester
// live-fired against LIVE PROD gqnoajqerqhnvulmnyvv on 2026-07-03:
//
//   * ACTOR SPOOFING — the ONE client-exposed guarded RPC (admin_audit_probe)
//     must NEVER pass p_actor_email / p_actor_uid to admin_write_audit, so a
//     client cannot forge the audit actor through it. (The tester proved that a
//     DIRECT call to admin_write_audit WITH p_actor_* forges the actor — that is
//     a reported P1 on the helper's grant surface; this test locks the exposed
//     probe so the forge is never reachable via the sanctioned entry point.)
//   * EDGE actor-binding — the edge fn must bind the audit actor to the
//     JWT-VERIFIED caller (user.email / user.id from getUser), never to a
//     client-supplied body field.
//   * REASON ENFORCEMENT ORDERING — in admin_write_audit the reason gate must
//     fire BEFORE actor resolution AND before the INSERT, and the exposed probe
//     must request p_require_reason = true, so the D2 "typed reason required"
//     guarantee cannot be reordered/opted-out around the write.
//   * SEARCH_PATH hijack-resistance — BOTH definer fns must pin
//     search_path = 'public' (the happy-path only checks SECURITY DEFINER).
//
// Source-level (node:test + fs), immutable/append-only, fails-on-revert.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MIG_PRIMITIVE =
  "supabase/migrations/20261204000002_orch_1271_admin_write_primitive.sql";
const EDGE = "supabase/functions/admin-write-primitive/index.ts";

const primitiveSql = read(MIG_PRIMITIVE);
const edgeTs = read(EDGE);

// Slice a plpgsql function body ($$ ... $$) for the named function.
const fnBody = (name) => {
  const m = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`,
    "i"
  ).exec(primitiveSql);
  assert.ok(m, `function public.${name} defined`);
  const rest = primitiveSql.slice(m.index);
  const open = rest.indexOf("$$");
  return rest.slice(open + 2, rest.indexOf("$$", open + 2));
};
// Slice the full CREATE ... header+body (for header-level checks like search_path).
const fnDef = (name) => {
  const m = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`,
    "i"
  ).exec(primitiveSql);
  const rest = primitiveSql.slice(m.index);
  const end = rest.indexOf("$$", rest.indexOf("$$") + 2);
  return rest.slice(0, end + 2);
};

describe("ORCH-1271 ADV — actor spoofing is unreachable via the exposed probe", () => {
  it("admin_audit_probe NEVER passes p_actor_email / p_actor_uid to admin_write_audit", () => {
    const body = fnBody("admin_audit_probe");
    // Isolate the admin_write_audit(...) call the probe makes.
    const callStart = body.search(/admin_write_audit\s*\(/i);
    assert.ok(callStart >= 0, "probe calls admin_write_audit");
    const call = body.slice(callStart);
    // The forge surface (p_actor_*) must NOT appear in the exposed probe's call.
    assert.doesNotMatch(
      call,
      /p_actor_email|p_actor_uid/i,
      "exposed probe must not forward actor-override args (actor-spoofing surface)"
    );
  });

  it("admin_audit_probe enforces the reason gate (p_require_reason = true, not false)", () => {
    const body = fnBody("admin_audit_probe");
    // The final positional arg to admin_write_audit is p_require_reason = true.
    assert.match(
      body,
      /jsonb_build_object\('note',\s*p_note\),\s*true\s*\)/i,
      "probe must request p_require_reason=true so reason cannot be silently skipped"
    );
    assert.doesNotMatch(
      body,
      /jsonb_build_object\('note',\s*p_note\),\s*false/i,
      "probe must not opt out of the reason requirement"
    );
  });
});

describe("ORCH-1271 ADV — edge fn binds the actor to the verified caller, not client input", () => {
  it("actor is taken from the getUser()-verified user, never from the request body", () => {
    assert.match(edgeTs, /p_actor_email:\s*user\.email/);
    assert.match(edgeTs, /p_actor_uid:\s*user\.id/);
    // A client must NOT be able to inject the actor through the POST body.
    assert.doesNotMatch(
      edgeTs,
      /body\.(actor|actor_email|actor_uid|p_actor_email|p_actor_uid|admin_email)/i,
      "edge fn must not read an actor field from the request body"
    );
  });
});

describe("ORCH-1271 ADV — reason gate ordering in admin_write_audit (D2 cannot be reordered around the write)", () => {
  const body = fnBody("admin_write_audit");
  const reasonIdx = body.search(/RAISE EXCEPTION 'reason_required'/i);
  const actorResolveIdx = body.search(/v_uid\s*:=\s*COALESCE\(p_actor_uid/i);
  const insertIdx = body.search(/INSERT INTO public\.admin_audit_log/i);

  it("the reason_required gate exists and precedes actor resolution", () => {
    assert.ok(reasonIdx >= 0, "reason_required gate present");
    assert.ok(actorResolveIdx >= 0, "actor resolution present");
    assert.ok(
      reasonIdx < actorResolveIdx,
      "reason gate must fire BEFORE actor resolution"
    );
  });

  it("the reason_required gate precedes the audit INSERT", () => {
    assert.ok(insertIdx >= 0, "audit INSERT present");
    assert.ok(
      reasonIdx < insertIdx,
      "reason gate must fire BEFORE the audit-log write"
    );
  });
});

describe("ORCH-1271 ADV — search_path hijack-resistance on BOTH definer fns", () => {
  for (const name of ["admin_write_audit", "admin_audit_probe"]) {
    it(`${name} pins SET search_path TO 'public'`, () => {
      const def = fnDef(name);
      assert.match(
        def,
        /SECURITY DEFINER\s+SET search_path TO 'public'/i,
        `${name} must pin search_path=public to resist search_path hijack`
      );
    });
  }
});
