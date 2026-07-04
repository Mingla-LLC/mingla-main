// ORCH-1273 [Admin Offerings console — READ-ONLY] — HAPPY-PATH regression.
//
// Source-level proof (node:test + fs, no DOM — mirrors the ORCH-1271 / ORCH-1272
// admin regression pattern) that the offerings READ console is wired end-to-end
// AND stays visibility-first:
//   1. RLS migration adds the 14 is_admin_user() SELECT policies (the admin-
//      visible data paths — incl. DRAFT/PRIVATE/cross-brand/soft-deleted rows a
//      non-admin cannot read).
//   2. The 5 read RPCs are guard-FIRST, STABLE, READ-ONLY, and least-privilege
//      locked (anon/PUBLIC revoked, authenticated granted, apply-time self-assert)
//      — the PII/money base tables get NO admin RLS, so buyer/guest data flows
//      through the definer RPCs, never a browser read.
//   3. offeringsService + venuesService are the single READ authority: read RPCs
//      + RLS-direct .select(), NO .update/.insert/.delete/.upsert/admin_write_audit.
//   4. Offerings + Venues pages consume EntityListView / EntityDetailView + the
//      ?offeringId= / ?venueId= deep-links, and ship zero edit actions.
//   5. Nav: the "Business" group gains Offerings + Venues; App.jsx routes them;
//      Sidebar ICON_MAP registers CalendarDays + Store (else silent fallback).
//   6. The strict-grep gate + workflow job exist; the 6 RPCs are in the gate-first
//      registry; the two DRAFT invariants are registered.
//
// Fails-on-revert target = the RLS/RPC migration + the service RPC calls: deleting
// any policy line, an RPC guard, or an rpc("admin_...") call makes this suite RED.
// The tester writes a SECOND, adversarial live-fire suite (the cross-row AC-1.4 /
// AC-2.6 / AC-3.3 proofs against the deployed migration).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel) => fs.readFileSync(path.join(ADMIN_SRC, rel), "utf8");

const stripSqlComments = (src) => src.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const stripJsComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

const MIG_RLS = "supabase/migrations/20261206000000_orch_1273_offerings_admin_read_rls.sql";
const MIG_RPC = "supabase/migrations/20261206000001_orch_1273_offerings_read_rpcs.sql";

const READ_TABLES = [
  "events", "event_dates", "ticket_types", "trip_days", "trip_pricing_tiers",
  "trip_inclusions", "trip_intake_schemas", "experience_stops", "experience_feedback",
  "venue_reservation_settings", "venue_capacity_rules", "venue_tables",
  "venue_blackouts", "venue_waitlist",
];
const READ_RPCS = [
  "admin_list_offerings", "admin_get_offering", "admin_list_event_orders",
  "admin_list_event_rsvps", "admin_list_venue_reservations",
];

function fnBody(sql, name) {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i").exec(sql);
  assert.ok(m, `${name} defined`);
  const rest = sql.slice(m.index);
  const open = rest.indexOf("$$");
  return { header: rest.slice(0, open), body: rest.slice(open + 2, rest.indexOf("$$", open + 2)) };
}

describe("ORCH-1273 — offerings admin-read RLS migration", () => {
  const sql = read(MIG_RLS);
  for (const t of READ_TABLES) {
    it(`adds an is_admin_user() SELECT policy on ${t}`, () => {
      const re = new RegExp(
        `create\\s+policy\\s+"${t} admin can read"\\s+on\\s+public\\.${t}\\s+for\\s+select\\s+using\\s*\\(\\s*public\\.is_admin_user\\(\\)\\s*\\)`,
        "i",
      );
      assert.match(sql, re);
    });
  }
  it("adds all 14 enumerated policies (the SPEC '13' is a miscount)", () => {
    const count = (sql.match(/CREATE POLICY "[^"]+ admin can read"/gi) || []).length;
    assert.equal(count, 14);
  });
  it("never re-introduces the account_type='admin' split gate", () => {
    assert.doesNotMatch(stripSqlComments(sql), /account_type/i);
  });
  it("is SELECT-only: no FOR ALL/UPDATE/INSERT/DELETE policy or table mutation", () => {
    const bare = stripSqlComments(sql);
    assert.doesNotMatch(bare, /FOR\s+(ALL|UPDATE|INSERT|DELETE)/i);
    assert.doesNotMatch(bare, /\b(ALTER TABLE|UPDATE\s+public\.|INSERT INTO|DELETE FROM)\b/i);
  });
  it("self-asserts 14 SELECT-only policies at apply time", () => {
    assert.match(sql, /v_select\s*<>\s*14/);
    assert.match(sql, /v_nonselect\s*<>\s*0/);
  });
});

describe("ORCH-1273 — offerings read-RPC migration", () => {
  const sql = read(MIG_RPC);
  for (const name of READ_RPCS) {
    it(`${name} is STABLE SECURITY DEFINER and guards FIRST on is_admin_user()`, () => {
      const { header, body } = fnBody(sql, name);
      assert.match(header, /STABLE/i, `${name} STABLE`);
      assert.match(header, /SECURITY DEFINER/i, `${name} SECURITY DEFINER`);
      const first = body
        .slice(body.search(/\bBEGIN\b/i) + "BEGIN".length)
        .split("\n")
        .filter((l) => !/^\s*--/.test(l))
        .join("\n")
        .split(";")[0]
        .trim();
      assert.match(first, /^IF\s+NOT\s+public\.is_admin_user\(\)\s+THEN\s+RAISE/i, `${name} guard-first`);
    });
    it(`${name} is READ-ONLY: no INSERT/UPDATE/DELETE, no admin_write_audit`, () => {
      const { body } = fnBody(sql, name);
      assert.doesNotMatch(body, /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
      assert.doesNotMatch(body, /admin_write_audit/i);
    });
  }
  it("returns the {rows,total} contract for the list RPCs", () => {
    assert.match(sql, /'rows',\s*v_rows,\s*'total'/);
  });
  it("server-computes the lifecycle bucket (draft + live window)", () => {
    assert.match(sql, /'draft'/);
    assert.match(sql, /interval '4 hours'/);
    assert.match(sql, /interval '24 hours'/);
    assert.match(sql, /'live'/);
  });
  it("enforces least-privilege for EVERY RPC (anon/PUBLIC revoked, authenticated granted)", () => {
    for (const name of [...READ_RPCS, "admin_offering_stats"]) {
      assert.match(sql, new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\([^)]*\\)\\s+FROM\\s+anon,\\s*PUBLIC`, "i"), `${name} REVOKE`);
      assert.match(sql, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${name}\\([^)]*\\)\\s+TO\\s+authenticated`, "i"), `${name} GRANT`);
    }
  });
  it("apply-time self-assert proves anon cannot execute + authenticated can", () => {
    assert.match(sql, /has_function_privilege\('anon',\s*v_sig,\s*'EXECUTE'\)/i);
    assert.match(sql, /has_function_privilege\('authenticated',\s*v_sig,\s*'EXECUTE'\)/i);
  });
});

describe("ORCH-1273 — offerings + venues read services (single READ authority)", () => {
  const off = stripJsComments(readSrc("services/offeringsService.js"));
  const ven = stripJsComments(readSrc("services/venuesService.js"));
  it("offeringsService calls the offerings read RPCs", () => {
    for (const n of ["admin_list_offerings", "admin_get_offering", "admin_list_event_orders", "admin_list_event_rsvps"]) {
      assert.match(off, new RegExp(`rpc\\("${n}"`), `calls ${n}`);
    }
  });
  it("venuesService calls admin_list_venue_reservations + reads venue_listings RLS-direct", () => {
    assert.match(ven, /rpc\("admin_list_venue_reservations"/);
    assert.match(ven, /\.from\("venue_listings"\)/);
  });
  it("both services are READ-ONLY: no .update/.insert/.delete/.upsert/admin_write_audit", () => {
    for (const svc of [off, ven]) {
      assert.doesNotMatch(svc, /\.update\(/);
      assert.doesNotMatch(svc, /\.insert\(/);
      assert.doesNotMatch(svc, /\.delete\(/);
      assert.doesNotMatch(svc, /\.upsert\(/);
      assert.doesNotMatch(svc, /admin_write_audit/);
    }
  });
  it("never selects the brand kind column (META-ORCH-0972)", () => {
    for (const svc of [off, ven]) {
      assert.doesNotMatch(svc, /brand[s]?\.kind/);
      assert.doesNotMatch(svc, /currentBrand\.kind/);
    }
  });
});

describe("ORCH-1273 — Offerings + Venues pages", () => {
  const offList = readSrc("pages/OfferingsConsolePage.jsx");
  const offDetail = readSrc("pages/OfferingDetailView.jsx");
  const venList = readSrc("pages/VenuesConsolePage.jsx");
  const venDetail = readSrc("pages/VenueDetailView.jsx");
  it("Offerings list uses EntityListView + listOfferings + the ?offeringId= deep-link, no edits", () => {
    assert.match(offList, /EntityListView/);
    assert.match(offList, /listOfferings/);
    assert.match(offList, /offeringId/);
    for (const forbidden of [".update(", ".insert(", ".delete(", ".upsert(", "admin_write_audit", "HighRiskActionModal"]) {
      assert.ok(!offList.includes(forbidden), `no ${forbidden} in Offerings list`);
    }
  });
  it("Offering detail is type-aware via EntityDetailView; wave-2 (ORCH-1277) adds audited actions but NO raw table writes", () => {
    // [TEST-MOD-APPROVED ORCH-1277] The ORCH-1273 read-only "EMPTY actions slot"
    // assertion is SUPERSEDED by ORCH-1277 [Admin Offerings console — WAVE-2 EDIT]:
    // OfferingDetailView now passes an `actions` footer + reason/confirm modals
    // (HighRiskActionModal for valueless HIGH actions). The read-only clause that
    // SURVIVES — and is asserted below — is the raw-table-write ban: every mutation
    // routes through the audited callAdminWriteRpc RPCs, never a direct .update/.insert/
    // .delete/.upsert. (See I-PROPOSED-1277-OFFERINGS-WRITE-VIA-AUDITED-RPC.)
    assert.match(offDetail, /EntityDetailView/);
    assert.match(offDetail, /getOffering/);
    assert.match(offDetail, /actions=\{/); // wave-2: carries the audited edit actions
    for (const forbidden of [".update(", ".insert(", ".delete(", ".upsert("]) {
      assert.ok(!offDetail.includes(forbidden), `no raw ${forbidden} in Offering detail (writes go via audited RPCs)`);
    }
  });
  it("Venues list + detail use the entity shells + the ?venueId= deep-link, no edits", () => {
    assert.match(venList, /EntityListView/);
    assert.match(venList, /listVenues/);
    assert.match(venList, /venueId/);
    assert.match(venDetail, /EntityDetailView/);
    assert.match(venDetail, /listVenueReservations/);
    for (const src of [venList, venDetail]) {
      for (const forbidden of [".update(", ".insert(", ".delete(", ".upsert(", "HighRiskActionModal"]) {
        assert.ok(!src.includes(forbidden), `no ${forbidden} in Venues`);
      }
    }
  });
});

describe("ORCH-1273 — nav + routing", () => {
  it("NAV_GROUPS 'Business' group gains Offerings + Venues", () => {
    const biz = NAV_GROUPS.find((g) => g.label === "Business");
    assert.ok(biz, "Business group present");
    assert.ok(biz.items.some((i) => i.id === "business-offerings" && i.icon === "CalendarDays"));
    assert.ok(biz.items.some((i) => i.id === "business-venues" && i.icon === "Store"));
    assert.ok(NAV_ITEMS.some((i) => i.id === "business-offerings"));
    assert.ok(NAV_ITEMS.some((i) => i.id === "business-venues"));
  });
  it("App.jsx routes #/business-offerings + #/business-venues", () => {
    const app = readSrc("App.jsx");
    assert.match(app, /import \{ OfferingsConsolePage \} from "\.\/pages\/OfferingsConsolePage"/);
    assert.match(app, /import \{ VenuesConsolePage \} from "\.\/pages\/VenuesConsolePage"/);
    assert.match(app, /"business-offerings": OfferingsConsolePage/);
    assert.match(app, /"business-venues": VenuesConsolePage/);
  });
  it("Sidebar ICON_MAP registers CalendarDays + Store (else silent fallback)", () => {
    const sb = readSrc("components/layout/Sidebar.jsx");
    assert.match(sb, /const ICON_MAP = \{[\s\S]*?\bCalendarDays\b[\s\S]*?\};/);
    assert.match(sb, /const ICON_MAP = \{[\s\S]*?\bStore\b[\s\S]*?\};/);
  });
});

describe("ORCH-1273 — gate + workflow + registry", () => {
  it("i-offerings-read-only.mjs exists and supports --self-test", () => {
    const g = read(".github/scripts/strict-grep/i-offerings-read-only.mjs");
    assert.match(g, /--self-test/);
    for (const t of READ_TABLES) assert.ok(g.includes(t), `gate references ${t}`);
    for (const n of READ_RPCS) assert.ok(g.includes(n), `gate references ${n}`);
  });
  it("workflow registers the orch-1273-offerings-read-only job", () => {
    const wf = read(".github/workflows/strict-grep-mingla-business.yml");
    assert.match(wf, /orch-1273-offerings-read-only:/);
    assert.match(wf, /i-offerings-read-only\.mjs/);
  });
  it("the 6 read RPCs are appended to the gate-first registry (not the write-RPC registry)", () => {
    const gate = read(".github/scripts/strict-grep/i-admin-gate-first-statement.mjs");
    for (const n of [...READ_RPCS, "admin_offering_stats"]) assert.match(gate, new RegExp(`"${n}"`), `${n} in gate-first`);
    const writeGate = read(".github/scripts/strict-grep/i-admin-write-audited.mjs");
    for (const n of READ_RPCS) assert.doesNotMatch(writeGate, new RegExp(n), `${n} NOT in write-RPC registry`);
  });
  it("both invariants are registered (ACTIVE after META-ORCH-1237 CLOSE)", () => {
    const reg = read("Mingla_Artifacts/INVARIANT_REGISTRY.md");
    // ORCH-1293 [TEST-MOD-APPROVED ORCH-1293]: META-ORCH-1237 CLOSE flipped these
    // two ORCH-1273 invariants DRAFT -> ACTIVE in INVARIANT_REGISTRY.md (PR #743)
    // but did not update this assertion, leaving main red on any strict-grep-
    // triggering PR. Assert the current, correct ACTIVE status.
    assert.match(reg, /I-PROPOSED-1273-OFFERINGS-ADMIN-READ-CROSSBRAND \(ACTIVE\)/);
    assert.match(reg, /I-PROPOSED-1273-OFFERINGS-READ-ONLY \(ACTIVE\)/);
  });
});
