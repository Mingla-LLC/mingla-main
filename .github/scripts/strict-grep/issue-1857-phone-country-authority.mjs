#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PATHS = {
  adapter: "packages/card-identity/phone.js",
  phoneInput: "packages/phone-input/PhoneInput.tsx",
  countryPicker: "packages/phone-input/CountryPickerModal.tsx",
  pickerBehavior: "packages/phone-input/pickerPresentation.ts",
  phoneDeclaration: "packages/card-identity/phone.d.ts",
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
const forbidPattern = (source, pattern, label, failures) => {
  if (pattern.test(source)) failures.push(`${label}: forbidden ${pattern}`);
};

export function violations(files) {
  const failures = [];
  need(files.adapter, "function resolveUserPhoneE164", "adapter", failures);
  need(files.adapter, "if (STRICT_E164.test(trimmed)) return trimmed", "adapter E.164 wins", failures);
  need(files.adapter, "dialablePhone(trimmed, countryIso)", "single converter", failures);
  need(files.phoneInput, "countryCode: string | null", "neutral picker", failures);
  need(files.phoneInput, '"Select country"', "neutral picker", failures);
  need(files.phoneInput, "pickerCloseFocusTarget(countryWasSelected.current)", "picker focus restoration", failures);
  need(files.countryPicker, "webOverlayFocusAction({", "picker focus trap", failures);
  need(files.countryPicker, "shouldHapticCountrySelection(Platform.OS)", "native-only haptics", failures);
  need(files.pickerBehavior, 'if (input.key === "Escape") return "close"', "picker Escape", failures);
  need(files.pickerBehavior, 'return platform !== "web"', "no web haptics", failures);
  need(files.pickerBehavior, 'return countryWasSelected ? "phone" : "country"', "picker close focus", failures);
  need(files.phoneDeclaration, "export function resolveUserPhoneE164(", "declaration adapter append", failures);
  need(files.rsvp, "phoneCountryIso: null", "RSVP independent state", failures);
  need(files.rsvp, "key={g.id}", "RSVP stable identity", failures);
  need(files.rsvp, "phoneCountryIso: g.phoneCountryIso", "RSVP transport", failures);
  need(files.rsvp, "markRsvpPhoneTouchedById(rows, g.id)", "RSVP blur isolation", failures);
  need(files.rsvp, "showValidationErrors || primaryPhoneTouched", "RSVP primary blur", failures);
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
    "ERRCODE = 'P1901'",
    "MESSAGE = 'rsvp_event_ended'",
    "ERRCODE = 'P1902'",
    "MESSAGE = 'rsvp_date_unavailable'",
    "DROP FUNCTION public.pg_create_guest_reservation(",
    "FROM PUBLIC,anon,authenticated,service_role",
  ]) need(migration, token, "migration", failures);
  for (const fingerprint of [
    "787eae74cc2b878be905899915ceeb53", "1c69cfda97aedfc8ba846f6e6193c5c2",
    "e83d8deb8b6e2f55517e29fb7b7f67c0", "dd09169aa2385b711fc5c54cf7039940",
    "d014cc5dff178ad164e9c556c4f75c9b", "327b12492edb0402c28547ec06bfb52d",
    "6c7beaa8437fac93cfd75f37528598e4", "f24e11a15a1a692f0a0b4f3559264826",
    "498565615bd834f1d3efa95fb3d4552c", "3810b4f9ee2d8faeb9f2b373959b0756",
    "9fe5e36dee2bd3bdc8ed26e2081716fb", "eec5f6a9750eb113d3c75c027455a704",
    "49ffd0c7006d839ca41fbcf0a082d643", "97adc49789e7e254744ff9b60efbe9ba",
    "51b79bcbec509bfd5f3a115f87af472d", "eaa44b5386a7a6a668e69ce769cdd6d8",
    "82f95d2c7440945e43df55948c164f1f",
  ]) need(migration, fingerprint, "migration definition fingerprint", failures);
  for (const token of [
    "issue_1857_source_drift_fingerprint", "issue_1857_post_definition_drift",
    "issue_1857_derived_definition_changed", "issue_1857_trigger_definition_changed",
    "issue_1857_schema_postcondition_failed", "issue_1857_acl_postcondition_failed",
    "issue_1857_revision_or_source_scope_postcondition_failed",
  ]) need(migration, token, "migration fail-closed guard", failures);
  if ((migration.match(/CREATE(?: OR REPLACE)? FUNCTION public\./g) ?? []).length !== 8) {
    failures.push("migration: expected exactly eight replacement functions");
  }
  forbidPattern(migration, /^CREATE TRIGGER\s/m, "migration zero trigger changes", failures);
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
    ["migration", "MESSAGE = 'rsvp_event_ended'", "MESSAGE = 'rsvp_open'"],
    ["migration", "MESSAGE = 'rsvp_date_unavailable'", "MESSAGE = 'rsvp_open'"],
    ["migration", "DROP FUNCTION public.pg_create_guest_reservation(", "-- old overload retained\n--"],
    ["pickerBehavior", 'return platform !== "web"', "return true"],
    ["pickerBehavior", 'if (input.key === "Escape") return "close"', "if (false) return null"],
    ["rsvp", "markRsvpPhoneTouchedById(rows, g.id)", "rows"],
    ["invariant", "I-PROPOSED-PHONE-COUNTRY-AUTHORITY-1 (DRAFT)", "REMOVED"],
  ];
  for (const fingerprint of [
    "787eae74cc2b878be905899915ceeb53", "1c69cfda97aedfc8ba846f6e6193c5c2",
    "e83d8deb8b6e2f55517e29fb7b7f67c0", "dd09169aa2385b711fc5c54cf7039940",
    "d014cc5dff178ad164e9c556c4f75c9b", "327b12492edb0402c28547ec06bfb52d",
    "6c7beaa8437fac93cfd75f37528598e4", "f24e11a15a1a692f0a0b4f3559264826",
    "498565615bd834f1d3efa95fb3d4552c", "3810b4f9ee2d8faeb9f2b373959b0756",
    "9fe5e36dee2bd3bdc8ed26e2081716fb", "eec5f6a9750eb113d3c75c027455a704",
    "49ffd0c7006d839ca41fbcf0a082d643", "97adc49789e7e254744ff9b60efbe9ba",
    "51b79bcbec509bfd5f3a115f87af472d", "eaa44b5386a7a6a668e69ce769cdd6d8",
    "82f95d2c7440945e43df55948c164f1f",
  ]) mutations.push(["migration", fingerprint, "00000000000000000000000000000000"]);
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
