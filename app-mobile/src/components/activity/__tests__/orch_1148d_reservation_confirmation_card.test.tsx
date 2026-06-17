// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// META-ORCH-1148 2.2d [locked-in confirmation card] — after booking, the
// reservation must surface in the Calendar tab as a tappable card (like the
// scheduled-experience cards already there) that, when EXPANDED, shows a
// prominent "Confirmed — you're locked in" banner + the full confirmation
// details (when, party, deposit/payment, occasion, confirmation ref, venue),
// and the data layer must fetch the venue cover/photo so the card matches the
// scheduled-card look.
//
// SOURCE-STRING assertions (the RN row/hook can't mount under the node harness
// — the established ORCH-1138/1148 consumer pattern). fails-on-revert: each
// ok(...) flips red if the corresponding fix line is removed. Owner:
// mingla-implementor.

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
const hookSrc = stripComments(read(`${APP}/src/hooks/useMyReservations.ts`));

// ── Data layer — the hook fetches the venue cover/photo + notes ─────────────
ok(
  "useMyReservations selects the brand cover media + photo + hue",
  /brands\(name,\s*cover_media_url,\s*cover_media_type,\s*profile_photo_url,\s*cover_hue/.test(
    hookSrc,
  ),
  "expected brands(name, cover_media_url, cover_media_type, profile_photo_url, cover_hue)",
);
ok(
  "MyReservationRow exposes brand cover fields",
  /brand_cover_url:/.test(hookSrc) &&
    /brand_cover_type:/.test(hookSrc) &&
    /brand_photo_url:/.test(hookSrc) &&
    /brand_cover_hue:/.test(hookSrc),
);
ok(
  "useMyReservations also reads guest_notes",
  /guest_notes/.test(hookSrc),
);

// ── Card — expandable like the scheduled cards ──────────────────────────────
ok(
  "row is expandable (collapsed ↔ expanded state)",
  /useState\(false\)/.test(rowSrc) && /setExpanded\(\(v\)\s*=>\s*!v\)/.test(rowSrc),
  "expected an `expanded` toggle on tap",
);
ok(
  "collapsed header shows a venue cover thumbnail (image or hue fallback)",
  /ImageWithFallback/.test(rowSrc) && /hueColor\(/.test(rowSrc),
);
ok(
  "expanded content is gated on `expanded`",
  /\{expanded\s*&&\s*\(/.test(rowSrc),
);

// ── The Confirmed banner — the locked-in confirmation ───────────────────────
ok(
  "expanded view renders a Confirmed / locked-in banner",
  /you're locked in/.test(rowSrc) && /bannerFor\(/.test(rowSrc),
  "expected the `Confirmed — you're locked in` banner",
);
ok(
  "confirmed status maps to the confirmed banner tone",
  /case "confirmed":[\s\S]*?tone:\s*"confirmed"/.test(rowSrc),
);

// ── Full confirmation details ───────────────────────────────────────────────
ok(
  "expanded view shows When / Party / Deposit / Confirmation / Venue rows",
  /label="When"/.test(rowSrc) &&
    /label="Party"/.test(rowSrc) &&
    /label="Deposit"/.test(rowSrc) &&
    /label="Confirmation"/.test(rowSrc) &&
    /label="Venue"/.test(rowSrc),
);
ok(
  "deposit line reflects the paid state",
  /payment_status === "paid"/.test(rowSrc) && /deposit · Paid/.test(rowSrc),
);
ok(
  "a human confirmation reference is derived from the id",
  /confirmationRef/.test(rowSrc) && /RES-/.test(rowSrc),
);

// ── Cancel preserved, gated on upcoming + confirmed/requested ───────────────
ok(
  "Cancel action survives and stays gated on cancellable",
  /isCancellable/.test(rowSrc) && /Cancel reservation/.test(rowSrc),
);

// ── 2.2e [QR + weather + traffic] — the digital reservation pass ─────────────
ok(
  "renders a check-in QR code encoding the reservation id",
  /from "react-native-qrcode-svg"/.test(rowSrc) &&
    /reservationQrValue\(/.test(rowSrc) &&
    /mingla:\/\/reservation\//.test(rowSrc),
);
ok(
  "QR is gated to live reservations (confirmed/pending tone)",
  /banner\.tone === "confirmed" \|\| banner\.tone === "pending"/.test(rowSrc),
);
ok(
  "shows the venue address row",
  /label="Address"/.test(rowSrc),
);
ok(
  "Directions opens native maps with driving/live-traffic routing",
  /openDirections\(/.test(rowSrc) &&
    /maps\.apple\.com\/\?daddr=/.test(rowSrc) &&
    /maps\/dir\/\?api=1&destination=/.test(rowSrc) &&
    /Directions & live traffic/.test(rowSrc),
);
ok(
  "fetches + renders the weather forecast for the venue + reservation time",
  /weatherService[\s\S]*getWeatherForecast\(/.test(rowSrc) &&
    /<WeatherSection/.test(rowSrc) &&
    /brand_lat/.test(rowSrc),
);
ok(
  "hook fetches venue address + coordinates for the pass",
  /address,\s*city,\s*lat,\s*lng/.test(hookSrc) &&
    /brand_lat:/.test(hookSrc) &&
    /brand_address:/.test(hookSrc),
);

console.log(`\n${passed} assertions passed.`);
