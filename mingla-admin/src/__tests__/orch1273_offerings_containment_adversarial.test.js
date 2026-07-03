// ORCH-1273 [Admin Offerings console — READ-ONLY] — TESTER ADVERSARIAL regression.
//
// DIFFERENT ANGLE than the implementor's happy-path suite
// (orch1273_offerings_console_read.test.js). That suite proves the 14 admin-read
// policies + 5 read RPCs EXIST and are wired. This suite attacks the three
// invariants the console can silently BREAK without any of those positive checks
// firing — the traps a "helpful" future edit walks straight into:
//
//   A. PII/MONEY CONTAINMENT (negative).  The 7 buyer/guest PII+money tables
//      (orders, order_line_items, tickets, order_installments, event_rsvps,
//      event_rsvp_guests, reservations) must have NO admin RLS — they are reachable
//      ONLY through the shaped definer RPCs (SPEC §5 "PII posture"). The implementor
//      suite only checks the 14 read tables are PRESENT; it never asserts the PII
//      tables are ABSENT. If someone adds `CREATE POLICY "orders admin can read" ON
//      public.orders ...`, that suite stays green — THIS one goes red.
//
//   B. DRAFT NOT SILENTLY FILTERED.  admin_list_offerings must never collapse to a
//      published/public-only list (the #1 silent-empty-read trap, AC-1.4). Its body
//      must carry no forced `visibility='public'` / `status='published'` /
//      `status<>'draft'` predicate, must default p_status/p_visibility to NULL and
//      only filter when explicitly asked, and must keep 'draft' as a first-class
//      lifecycle bucket.
//
//   C. LEAST-PRIVILEGE COMPLETENESS (file-derived).  EVERY function defined in the
//      RPC migration — not just a hard-coded list — must be REVOKEd from anon+PUBLIC
//      and guard-first on is_admin_user(). Deriving the function set from the file
//      catches a NEW admin RPC dropped in later that forgets the REVOKE or the guard
//      (a real anon-exposure / auth-bypass regression the hard-coded suite misses).
//
// FAILS-ON-REVERT (verified by the tester via true line-mutation at HEAD
// d70b229582c85707fb866f53d34af7af51db293c):
//   - add any `... admin can read` policy on a PII table  → A fails.
//   - add a `visibility='public'` filter to admin_list_offerings → B fails.
//   - remove a `REVOKE EXECUTE ... FROM anon, PUBLIC` line   → C fails.
//   - move/remove a function's is_admin_user() guard        → C fails.
//
// Source-level (node:test + fs) so it runs in CI with no DB — the live-fire draft/
// PII/anon proofs live in the QA report; this is the durable CI guard.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MIG_RLS = "supabase/migrations/20261206000000_orch_1273_offerings_admin_read_rls.sql";
const MIG_RPC = "supabase/migrations/20261206000001_orch_1273_offerings_read_rpcs.sql";

// Strip SQL line + block comments so a commented-out example never trips a check.
function stripSql(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

// The PII/money tables that MUST stay RLS-closed to the browser (definer-RPC only).
const PII_TABLES = [
  "orders",
  "order_line_items",
  "tickets",
  "order_installments",
  "event_rsvps",
  "event_rsvp_guests",
  "reservations",
];

// Parse every `CREATE [OR REPLACE] FUNCTION public.<name>(...)` — name + arg list +
// body between the first `$$` pair — from the RPC migration.
function parseFunctions(src) {
  const re = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const rest = src.slice(m.index);
    const open = rest.indexOf("$$");
    const close = open >= 0 ? rest.indexOf("$$", open + 2) : -1;
    const header = open >= 0 ? rest.slice(0, open) : rest.slice(0, 400);
    const body = open >= 0 && close >= 0 ? rest.slice(open + 2, close) : "";
    out.push({ name, header, body });
  }
  return out;
}

// ── A. PII / money containment (the core adversarial angle) ───────────────────
describe("ORCH-1273 ADV — PII/money tables stay RLS-closed (definer-RPC only)", () => {
  const rls = stripSql(read(MIG_RLS));
  const rpc = stripSql(read(MIG_RPC));

  for (const t of PII_TABLES) {
    it(`no admin (or any) RLS SELECT policy is created on public.${t}`, () => {
      // Any CREATE POLICY ... ON public.<pii_table> in the 1273 RLS migration is a
      // containment breach — these tables must never be browser-readable.
      const policyOnPii = new RegExp(`create\\s+policy\\s+[^;]*?\\bon\\s+public\\.${t}\\b`, "i");
      assert.ok(
        !policyOnPii.test(rls),
        `PII containment breach: a policy is created on public.${t} — it must be reachable ONLY via a definer RPC.`,
      );
    });
    it(`the RPC migration never adds a policy on public.${t} either`, () => {
      const policyOnPii = new RegExp(`create\\s+policy\\s+[^;]*?\\bon\\s+public\\.${t}\\b`, "i");
      assert.ok(!policyOnPii.test(rpc), `PII containment breach in RPC migration for public.${t}.`);
    });
  }

  it("the RLS migration's own self-assert pins the policy set to SELECT-only (14)", () => {
    // A stray FOR ALL/UPDATE policy under a `<table> admin can read` name would abort
    // apply — so read RLS can never silently become write RLS.
    assert.match(rls, /v_nonselect\s*<>\s*0/);
    assert.match(rls, /read RLS must be SELECT-only/i);
  });
});

// ── B. Draft/private/cross-brand never silently filtered out ──────────────────
describe("ORCH-1273 ADV — admin_list_offerings cannot collapse to a public-only list", () => {
  const rpc = stripSql(read(MIG_RPC));
  const fn = parseFunctions(rpc).find((f) => f.name === "admin_list_offerings");

  it("admin_list_offerings is defined", () => {
    assert.ok(fn, "admin_list_offerings present in the RPC migration");
  });

  it("carries NO forced public/published/non-draft predicate (the silent-empty-read trap)", () => {
    const body = fn.body;
    assert.doesNotMatch(body, /visibility\s*=\s*'public'/i, "forced visibility='public' would hide private/draft rows");
    assert.doesNotMatch(body, /status\s*=\s*'published'/i, "forced status='published' would hide drafts");
    assert.doesNotMatch(body, /status\s*=\s*'live'/i, "forced status='live' would hide everything else");
    assert.doesNotMatch(body, /status\s*(<>|!=)\s*'draft'/i, "excluding status<>'draft' would hide drafts — the whole point of the console");
    assert.doesNotMatch(body, /visibility\s*(<>|!=)\s*'draft'/i);
  });

  it("status + visibility filters are opt-in only (default NULL ⇒ every row surfaces)", () => {
    assert.match(fn.header, /p_status\s+text\s+default\s+null/i);
    assert.match(fn.header, /p_visibility\s+text\s+default\s+null/i);
    assert.match(fn.body, /\(\s*p_status\s+is\s+null\s+or\s+status\s*=\s*p_status\s*\)/i);
    assert.match(fn.body, /\(\s*p_visibility\s+is\s+null\s+or\s+visibility\s*=\s*p_visibility\s*\)/i);
  });

  it("keeps 'draft' as a first-class lifecycle bucket (admin sees drafts organisers never do)", () => {
    assert.match(fn.body, /when\s+e\.status\s*=\s*'draft'\s+then\s+'draft'/i);
  });

  it("deleted-row visibility is opt-in, and drafts (deleted_at IS NULL) always pass the default filter", () => {
    assert.match(fn.header, /p_include_deleted\s+boolean\s+default\s+false/i);
    assert.match(fn.body, /p_include_deleted\s+or\s+deleted_at\s+is\s+null/i);
  });
});

// ── C. Least-privilege + guard-first for EVERY defined function (file-derived) ─
describe("ORCH-1273 ADV — every RPC in the migration is anon-locked + guard-first", () => {
  const rpc = stripSql(read(MIG_RPC));
  const fns = parseFunctions(rpc);

  it("finds the admin read RPCs (sanity — parser is working)", () => {
    const names = fns.map((f) => f.name);
    assert.ok(names.includes("admin_list_offerings"), "parsed admin_list_offerings");
    assert.ok(names.length >= 6, `expected >=6 functions, parsed ${names.length}: ${names.join(",")}`);
  });

  for (const f of parseFunctions(stripSql(read(MIG_RPC)))) {
    it(`${f.name}: REVOKEd from anon + PUBLIC (no anon EXECUTE reaches an admin RPC)`, () => {
      const revoke = new RegExp(
        `revoke\\s+execute\\s+on\\s+function\\s+public\\.${f.name}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\banon\\b`,
        "i",
      );
      assert.ok(revoke.test(rpc), `${f.name} is never REVOKEd from anon — anon could EXECUTE an admin RPC.`);
      // and must NOT hand EXECUTE back to anon/PUBLIC anywhere.
      const grantAnon = new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+public\\.${f.name}\\s*\\([^)]*\\)\\s+to\\s+[^;]*\\b(anon|public)\\b`,
        "i",
      );
      assert.ok(!grantAnon.test(rpc), `${f.name} GRANTs EXECUTE back to anon/PUBLIC — least-privilege breach.`);
    });

    it(`${f.name}: guards on is_admin_user() as its FIRST executable statement`, () => {
      const afterBegin = f.body.slice(f.body.search(/\bbegin\b/i) + "begin".length);
      const firstStmt = afterBegin
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .split(";")[0]
        .trim();
      assert.match(
        firstStmt,
        /^if\s+not\s+public\.is_admin_user\(\)\s+then\s+raise/i,
        `${f.name} does work before the admin guard — guard must be the first statement.`,
      );
    });
  }
});
