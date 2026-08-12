#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  adapter: "packages/card-identity/phone.js",
  phoneInput: "packages/phone-input/PhoneInput.tsx",
  rsvp: "packages/offering-rendering/RsvpOfferingBody.tsx",
  stay: "packages/brand-rendering/StayGuestBooking.tsx",
  rsvpEdge: "supabase/functions/public-submit-rsvp/index.ts",
  stayEdge: "supabase/functions/stay-reservations/index.ts",
  reservationEdge: "supabase/functions/venue-reservation-create/index.ts",
  nativeReservation: "app-mobile/src/services/venueReservationService.ts",
  webReservation: "mingla-business/src/services/venueGuestReservationService.ts",
  migration: "supabase/migrations/20270323001857_issue_1857_phone_country_authority.sql",
  invariant: "docs/INVARIANT_REGISTRY.md",
  workflow: ".github/workflows/issue-1857-phone-country-authority-tests.yml",
};

const need = (source, token, label, failures) => {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
};
const forbid = (source, token, label, failures) => {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
};

export function violations(files) {
  const failures = [];
  need(files.adapter, "function resolveUserPhoneE164", "adapter", failures);
  need(files.adapter, "if (STRICT_E164.test(trimmed)) return trimmed", "adapter E.164 wins", failures);
  need(files.adapter, "dialablePhone(trimmed, countryIso)", "single converter", failures);
  need(files.phoneInput, "countryCode: string | null", "neutral picker", failures);
  need(files.phoneInput, '"Select country"', "neutral picker", failures);
  need(files.rsvp, "phoneCountryIso: null", "RSVP independent state", failures);
  need(files.rsvp, "key={g.id}", "RSVP stable identity", failures);
  need(files.rsvp, "phoneCountryIso: g.phoneCountryIso", "RSVP transport", failures);
  forbid(files.rsvp, 'defaultPhoneCountry ?? "US"', "RSVP inferred default", failures);
  need(files.stay, "...(cleanPhone && phoneCountryIso ? { phoneCountryIso } : {})", "Stay transport", failures);
  need(files.rsvpEdge, "const PHONE_RE = /^\\+[1-9][0-9]{7,14}$/", "RSVP strict Edge", failures);
  forbid(files.rsvpEdge, "`+${digits}`", "RSVP blind plus", failures);
  need(files.stayEdge, '["name", "email", "phone", "phoneCountryIso"]', "Stay exact keys", failures);
  need(files.reservationEdge, "buyer_phone_country_iso: buyerPhoneCountryIso", "paid session evidence", failures);
  need(files.reservationEdge, "p_guest_phone_country_iso: buyerPhoneCountryIso", "free reservation evidence", failures);
  forbid(files.reservationEdge, "normalizePhoneE164", "reservation country inference", failures);
  need(files.nativeReservation, "phoneCountryIso: input.buyer.phoneCountryIso", "Consumer reservation transport", failures);
  need(files.webReservation, "phoneCountryIso?: string | null", "Buyer reservation transport", failures);

  const migration = files.migration;
  for (const token of [
    "guest_phone_country_iso text",
    "buyer_phone_country_iso text",
    "phone_country_iso text",
    "reservation_phone_must_be_e164",
    "v_session.buyer_phone_country_iso",
    "phoneCountryIso",
  ]) need(migration, token, "migration", failures);
  if ((migration.match(/CREATE(?: OR REPLACE)? FUNCTION public\./g) ?? []).length !== 8) {
    failures.push("migration: expected exactly eight replacement functions");
  }
  forbid(migration, "CREATE TRIGGER", "migration zero trigger changes", failures);
  forbid(migration, "UPDATE public.event_rsvps SET guest_phone_country_iso", "migration no backfill", failures);
  need(files.invariant, "I-PROPOSED-PHONE-COUNTRY-AUTHORITY-1 (DRAFT)", "invariant", failures);
  need(files.workflow, "issue-1857-phone-country-authority.mjs --self-test", "CI self-test", failures);
  need(files.workflow, "issue_1857_phone_country_authority.pg17.test.sql", "CI SQL test", failures);
  return failures;
}

function readFiles() {
  return Object.fromEntries(Object.entries(PATHS).map(([key, relative]) => [
    key,
    fs.readFileSync(path.join(ROOT, relative), "utf8"),
  ]));
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);
  const mutations = [
    ["adapter", "if (STRICT_E164.test(trimmed)) return trimmed", "if (false) return trimmed"],
    ["rsvp", "key={g.id}", "key={i}"],
    ["rsvpEdge", "const PHONE_RE = /^\\+[1-9][0-9]{7,14}$/", "const PHONE_RE = /digits/"],
    ["reservationEdge", "buyer_phone_country_iso: buyerPhoneCountryIso", "buyer_phone_country_iso: null"],
    ["migration", "v_session.buyer_phone_country_iso", "NULL::text"],
    ["invariant", "I-PROPOSED-PHONE-COUNTRY-AUTHORITY-1 (DRAFT)", "REMOVED"],
  ];
  for (const [key, before, after] of mutations) {
    if (!clean[key].includes(before)) throw new Error(`fixture missing: ${key}`);
    if (violations({ ...clean, [key]: clean[key].replace(before, after) }).length === 0) {
      throw new Error(`mutation survived: ${key}`);
    }
  }
  console.log(`#1857 phone-country authority self-test PASS (${mutations.length} true mutations)`);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1857 phone-country authority gate PASS");
}
