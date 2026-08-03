import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const service = fs.readFileSync(
  path.resolve(here, "../venueOrganicCaptureService.ts"),
  "utf8",
);
const reservation = fs.readFileSync(
  path.resolve(here, "../venueReservationService.ts"),
  "utf8",
);

test("#1421 Consumer capture waits for analytics readiness/ATT and opt-out", () => {
  assert.match(service, /await postHogService\.initialize\(\)/);
  assert.match(service, /useAppStore\.getState\(\)\.analyticsOptOut/);
});

test("#1421 Consumer capture is non-blocking and threads an opaque token", () => {
  assert.match(service, /console\.warn\("\[venueOrganicCapture\]/);
  assert.match(reservation, /organicJourneyToken/);
  assert.match(reservation, /getVenueOrganicJourneyToken/);
});
