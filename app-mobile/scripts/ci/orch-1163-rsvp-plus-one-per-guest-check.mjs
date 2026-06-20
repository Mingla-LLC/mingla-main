#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-PLUS-ONE-PER-GUEST-CONTACT.
 *
 * FLOW B: each plus-one is a RELATIONAL child row in event_rsvp_guests with its OWN
 * name/email/phone (NOT NULL, non-empty CHECK) — NOT a count, NOT a JSONB blob on
 * event_rsvps. The child table has RLS on + host-read + owner-read policies and NO
 * anon/authenticated write GRANT (writes flow only through the SECURITY DEFINER
 * submit_event_rsvp under service_role). submit_event_rsvp validates the guest set
 * (count mismatch + per-guest contact). public-submit-rsvp surfaces the mismatch.
 *
 * Structural source-string gate. FAIL-ON-REVERT: drop a NOT NULL CHECK, the cascade
 * FK, RLS, a policy, the service-role-only grant, the raises, or re-introduce a
 * guests JSONB blob, and a check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const mig = read(
  "supabase/migrations/20261016000001_orch_1163_event_rsvp_guests.sql",
);
const submitFn = read("supabase/functions/public-submit-rsvp/index.ts");

check(
  "T1 creates table public.event_rsvp_guests",
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.event_rsvp_guests\b/.test(
    mig,
  ),
  "migration must CREATE TABLE public.event_rsvp_guests",
);
check(
  "T2 name/email/phone are NOT NULL with non-empty CHECK",
  /name\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*length\(btrim\(name\)\)\s*>\s*0\s*\)/.test(
    mig,
  ) &&
    /email\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*length\(btrim\(email\)\)\s*>\s*0\s*\)/.test(
      mig,
    ) &&
    /phone\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*length\(btrim\(phone\)\)\s*>\s*0\s*\)/.test(
      mig,
    ),
  "name/email/phone must be NOT NULL with a non-empty btrim CHECK",
);
check(
  "T3 FK to event_rsvps ON DELETE CASCADE",
  /rsvp_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+public\.event_rsvps\(id\)\s+ON\s+DELETE\s+CASCADE/.test(
    mig,
  ),
  "rsvp_id must FK to public.event_rsvps(id) ON DELETE CASCADE",
);
check(
  "T4 ENABLE ROW LEVEL SECURITY on the child table",
  /ALTER\s+TABLE\s+public\.event_rsvp_guests\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/.test(
    mig,
  ),
  "event_rsvp_guests must ENABLE ROW LEVEL SECURITY",
);
check(
  "T5 host-read + owner-read SELECT policies exist",
  /CREATE\s+POLICY\s+event_rsvp_guests_host_read\b/.test(mig) &&
    /CREATE\s+POLICY\s+event_rsvp_guests_owner_read\b/.test(mig),
  "both host-read and owner-read policies must be created",
);
check(
  "T6 NO anon/authenticated table write grant (only service_role)",
  /GRANT\s+[A-Z, ]*ON\s+TABLE\s+public\.event_rsvp_guests\s+TO\s+service_role/.test(
    mig,
  ) &&
    !/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]*?ON\s+TABLE\s+public\.event_rsvp_guests\s+TO\s+(?:anon|authenticated)/.test(
      mig,
    ),
  "table writes must be GRANTed only TO service_role (no anon/authenticated write grant)",
);
check(
  "T7 NO plus-one JSONB blob column on event_rsvps",
  !/ALTER\s+TABLE\s+public\.event_rsvps[\s\S]*?ADD\s+COLUMN[^;]*\bguests\b[^;]*\bjsonb\b/i.test(
    mig,
  ),
  "the migration must NOT add a `guests jsonb` column to event_rsvps (relational child only)",
);
check(
  "T8 submit_event_rsvp raises rsvp_guest_count_mismatch + rsvp_guest_contact_required",
  /RAISE\s+EXCEPTION\s+'rsvp_guest_count_mismatch'/.test(mig) &&
    /RAISE\s+EXCEPTION\s+'rsvp_guest_contact_required'/.test(mig),
  "submit_event_rsvp must validate the guest set (count mismatch + contact required)",
);
check(
  "T9 public-submit-rsvp validates guests (rsvp_guest_count_mismatch surfaced)",
  submitFn.includes("rsvp_guest_count_mismatch"),
  "public-submit-rsvp/index.ts must surface rsvp_guest_count_mismatch",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-plus-one-per-guest gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-plus-one-per-guest gate: PASS");
