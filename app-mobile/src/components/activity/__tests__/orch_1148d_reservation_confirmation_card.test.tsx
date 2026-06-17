// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// META-ORCH-1148 2.2f [reservation pass in the existing expanded card] —
// REWRITE of the 2.2d test. Per Seth, we do NOT reinvent an expanded design in
// the calendar row. Instead:
//   • the reservation row is a COMPACT, TAPPABLE card (cover · venue · time ·
//     party · chips) that calls onPress — it no longer expands in place;
//   • tapping opens the SAME ExpandedCardModal the app already uses for venues
//     (its weather / directions / gallery), into which a Confirmed reservation
//     PASS is injected: a status banner, a check-in QR code, the full details,
//     and Cancel. That pass lives in ReservationPassSection and is rendered by
//     ExpandedCardModal when `reservationPass` is provided;
//   • CalendarTab builds a venue ExpandedCardData + the pass from the tapped
//     reservation and opens the modal.
//
// SOURCE-STRING assertions (RN can't mount under node — the established
// ORCH-1138/1148 consumer pattern). fails-on-revert. Owner: mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

const APP = "app-mobile";
const rowSrc = stripComments(
  read(`${APP}/src/components/activity/ReservationCalendarRow.tsx`),
);
const passSrc = stripComments(
  read(`${APP}/src/components/expandedCard/ReservationPassSection.tsx`),
);
const modalSrc = stripComments(
  read(`${APP}/src/components/ExpandedCardModal.tsx`),
);
const calSrc = stripComments(
  read(`${APP}/src/components/activity/CalendarTab.tsx`),
);
const hookSrc = stripComments(read(`${APP}/src/hooks/useMyReservations.ts`));

// ── Data layer — hook fetches cover + notes + venue geo/address ──────────────
ok(
  "useMyReservations selects cover + address + coordinates",
  /brands\(name,\s*cover_media_url,\s*cover_media_type,\s*profile_photo_url,\s*cover_hue,\s*address,\s*city,\s*lat,\s*lng\)/.test(
    hookSrc,
  ),
);
ok(
  "MyReservationRow exposes venue address + lat/lng",
  /brand_address:/.test(hookSrc) &&
    /brand_lat:/.test(hookSrc) &&
    /brand_lng:/.test(hookSrc),
);

// ── Row — compact + tappable, NOT an in-place expanded card ──────────────────
ok(
  "row is a tappable card that calls onPress (no inline expand)",
  /onPress:\s*\(reservation/.test(rowSrc) &&
    /onPress\(reservation\)/.test(rowSrc) &&
    !/setExpanded/.test(rowSrc),
  "row should delegate to onPress and not manage its own expanded state",
);
ok(
  "row keeps the venue cover thumbnail + chips",
  /ImageWithFallback/.test(rowSrc) && /hueColor\(/.test(rowSrc),
);

// ── ExpandedCardModal — injects the reservation pass (reuse, not reinvent) ────
ok(
  "modal accepts a reservationPass prop",
  /reservationPass,/.test(modalSrc) || /reservationPass\b/.test(modalSrc),
);
ok(
  "modal renders ReservationPassSection when a pass is present",
  /import ReservationPassSection/.test(modalSrc) &&
    /\{reservationPass\s*&&\s*<ReservationPassSection\s+pass=\{reservationPass\}/.test(
      modalSrc,
    ),
);

// ── ReservationPassSection — banner + QR + full details + cancel ─────────────
ok(
  "pass renders a check-in QR encoding the reservation id",
  /from "react-native-qrcode-svg"/.test(passSrc) &&
    /mingla:\/\/reservation\/\$\{pass\.reservationId\}/.test(passSrc),
);
ok(
  "pass renders the Confirmed / locked-in banner",
  /you're locked in/.test(passSrc) && /bannerFor\(/.test(passSrc),
);
ok(
  "pass shows When / Party / Deposit / Confirmation / Venue",
  /label="When"/.test(passSrc) &&
    /label="Party"/.test(passSrc) &&
    /label="Deposit"/.test(passSrc) &&
    /label="Confirmation"/.test(passSrc) &&
    /label="Venue"/.test(passSrc),
);
ok(
  "pass deposit line reflects the paid state",
  /paymentStatus === "paid"/.test(passSrc) && /deposit · Paid/.test(passSrc),
);
ok(
  "pass exposes a gated Cancel action",
  /pass\.cancellable\s*&&\s*pass\.onCancel/.test(passSrc) &&
    /Cancel reservation/.test(passSrc),
);

// ── CalendarTab — taps build a venue card + pass and open the modal ──────────
ok(
  "tapping a reservation opens the modal via handleReservationPress",
  /handleReservationPress/.test(calSrc) &&
    /onPress=\{handleReservationPress\}/.test(calSrc),
);
ok(
  "the venue card carries location (weather) + address (directions)",
  /location:\s*hasCoords/.test(calSrc) &&
    /address:\s*reservation\.brand_address/.test(calSrc),
);
ok(
  "the modal is passed the built reservationPass",
  /reservationPass=\{reservationPassForModal\}/.test(calSrc) &&
    /setReservationPassForModal\(pass\)/.test(calSrc),
);
ok(
  "the pass cancel routes through the existing cancel handler",
  /handleCancelReservation\(reservation\)/.test(calSrc),
);

// ── 2.2g [video cover + real cancel/refund] ─────────────────────────────────
ok(
  "the venue card passes the cover URL regardless of type (video plays)",
  /const image =\s*\n?\s*reservation\.brand_cover_url \|\| reservation\.brand_photo_url \|\| ""/.test(
    calSrc,
  ),
  "video covers must reach ImageGallery, not be dropped to the placeholder",
);
ok(
  "cancelMyReservation calls the venue-reservation-cancel edge fn (executes refund)",
  /functions\.invoke\(\s*\n?\s*["']venue-reservation-cancel["']/.test(hookSrc),
);
ok(
  "cancel surfaces the actual refund outcome to the guest",
  /refunded,\s*refundAmountCents/.test(calSrc) &&
    /deposit has been refunded/.test(calSrc),
);

console.log(`\n${passed} assertions passed.`);
