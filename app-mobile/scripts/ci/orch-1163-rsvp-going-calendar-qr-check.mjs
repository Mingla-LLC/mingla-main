#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-GOING-CALENDAR-QR
 *                              + I-PROPOSED-1163-RSVP-PER-GUEST-PASS.
 *
 * FLOW C / §J: a GOING RSVP mints a signed entry pass — for the PRIMARY (qr_token_hash
 * / qr_code on event_rsvps) AND for EACH plus-one (qr_token_hash / qr_code on
 * event_rsvp_guests). The payload is `mingla:v1:rsvp:` (biz_rsvp_qr_payload), minted
 * ONLY for v_status = 'going', using the SHARED pepper hash helper
 * biz_ticket_checkout_token_hash. The going RSVP + its QR surface in the consumer
 * Calendar (a kind:"rsvp" UnifiedRow read via fetch_user_going_rsvps; the QR renders
 * through react-native-qrcode-svg in RsvpPassSheet).
 *
 * Structural source-string gate. FAIL-ON-REVERT: drop a qr col, the going-only mint
 * guard, the shared pepper hash, the calendar row, the service read, or the QR render.
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
const calendarTab = read("app-mobile/src/components/activity/CalendarTab.tsx");
const calendarService = read("app-mobile/src/services/calendarService.ts");
const passSheet = read("app-mobile/src/components/activity/RsvpPassSheet.tsx");

check(
  "T1 qr_token_hash + qr_code added to event_rsvps (the PRIMARY pass)",
  /ALTER\s+TABLE\s+public\.event_rsvps[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+qr_token_hash[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+qr_code/.test(
    mig,
  ),
  "event_rsvps must gain qr_token_hash + qr_code",
);
check(
  "T2 qr_token_hash + qr_code on event_rsvp_guests (the PER-GUEST pass)",
  /CREATE\s+TABLE[\s\S]*?public\.event_rsvp_guests[\s\S]*?qr_token_hash\s+text[\s\S]*?qr_code\s+text/.test(
    mig,
  ),
  "event_rsvp_guests must carry qr_token_hash + qr_code",
);
check(
  "T3 biz_rsvp_qr_payload emits the mingla:v1:rsvp: prefix",
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.biz_rsvp_qr_payload\b/.test(
    mig,
  ) && /'mingla:v1:rsvp:'/.test(mig),
  "biz_rsvp_qr_payload must emit the 'mingla:v1:rsvp:' payload prefix",
);
check(
  "T4 passes minted ONLY for going (guarded by v_status = 'going')",
  /v_status\s*=\s*'going'/.test(mig),
  "QR minting must be guarded by v_status = 'going'",
);
check(
  "T5 reuses the shared pepper hash helper biz_ticket_checkout_token_hash",
  /biz_ticket_checkout_token_hash\s*\(/.test(mig),
  "minting must reuse the shared biz_ticket_checkout_token_hash pepper helper",
);
check(
  "T6 CalendarTab has a kind: \"rsvp\" UnifiedRow variant",
  /kind:\s*"rsvp"/.test(calendarTab),
  "CalendarTab.tsx must add a kind: \"rsvp\" UnifiedRow variant",
);
check(
  "T7 calendarService reads fetch_user_going_rsvps",
  calendarService.includes("fetch_user_going_rsvps"),
  "calendarService.ts must call fetch_user_going_rsvps",
);
check(
  "T8 RsvpPassSheet renders the QR via react-native-qrcode-svg",
  passSheet.includes("react-native-qrcode-svg"),
  "RsvpPassSheet.tsx must render a QR via react-native-qrcode-svg",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-going-calendar-qr gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-going-calendar-qr gate: PASS");
