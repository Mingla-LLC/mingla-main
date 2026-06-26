#!/usr/bin/env node
/**
 * ORCH-1230 [consumer-apple-rejection-round2] —
 * I-PROPOSED-1230-CONSUMER-APPLE-REJECTION-ROUND2.
 *
 * WHY: Apple rejected the CONSUMER app (Mingla – Date Plans & City Gems, iOS
 * 1.1.0 build 30) a SECOND time. This gate locks the two CODE fixes so a revert
 * FAILS CI:
 *
 *   FIX A (Guideline 5.1.5) — the app must be FULLY FUNCTIONAL with Location
 *     Services OFF / permission DENIED. The manual "choose your city" escape must
 *     be reachable on the FIRST encounter, NOT gated behind `launchCheckFailures
 *     >= 2`. Asserts in OnboardingFlow.tsx:
 *       (a) the check-failed "Continue anyway" escape is NOT gated `>= 2`
 *           (the gate was lowered to `>= 1` — first failure);
 *       (b) the manual city picker is actually WIRED into the render — the
 *           `manualLocationOpen` state exists, `renderManualLocationPanel` is
 *           BOTH defined AND invoked, and `handleManualLocation` is called from
 *           the render (so the manual path is reachable, not orphaned).
 *
 *   FIX B (Guideline 5.1.1(ii)) — every calendar/reminder purpose string the
 *     build can present must carry a concrete example + user-initiated trigger.
 *     iOS 17 split the calendar permission, so the new keys
 *     (NSCalendars{FullAccess,WriteOnlyAccess}UsageDescription,
 *     NSRemindersFullAccessUsageDescription) must ALSO carry the concrete text.
 *     Asserts:
 *       (a) the expo-calendar plugin is NOT a bare string — it must be the
 *           ["expo-calendar", { calendarPermission, remindersPermission }] form
 *           with concrete example text (otherwise prebuild injects a GENERIC
 *           default for the iOS-17 keys — exactly what Apple screenshotted);
 *       (b) every calendar/reminder infoPlist key (old + iOS-17) contains a
 *           concrete example token (/reservation|ticketed show/).
 *
 * `--self-test` proves PASS-on-fix + FAIL-on-revert for each assertion.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const APP_JSON = path.join(root, "app-mobile/app.json");
const ONBOARDING_FLOW = path.join(
  root,
  "app-mobile/src/components/OnboardingFlow.tsx",
);

// Concrete-example token every calendar/reminder purpose string must carry.
const EXAMPLE_RE = /reservation|ticketed show/i;

// Every calendar/reminder purpose key (deprecated + iOS-17) the build presents.
const CALENDAR_KEYS = [
  "NSCalendarsUsageDescription",
  "NSCalendarsFullAccessUsageDescription",
  "NSCalendarsWriteOnlyAccessUsageDescription",
  "NSRemindersUsageDescription",
  "NSRemindersFullAccessUsageDescription",
];

// ── FIX A: location no-GPS path not gated behind >=2 failures ────────────────
function checkLocationNoGpsPath(flowSrc, failures) {
  // (a) The check-failed "Continue anyway" escape must NOT be gated `>= 2`.
  if (/launchCheckFailures\s*>=\s*2/.test(flowSrc)) {
    failures.push(
      `OnboardingFlow.tsx still gates the location escape behind \`launchCheckFailures >= 2\` — Apple 5.1.5 regression (a no-GPS / Location-Services-off user is stranded). The escape must appear on the FIRST failure (>= 1).`,
    );
  }
  // The escape must still be present, just lowered to >= 1.
  if (!/launchCheckFailures\s*>=\s*1/.test(flowSrc)) {
    failures.push(
      `OnboardingFlow.tsx must show the check-failed escape on the FIRST failure (\`launchCheckFailures >= 1\`).`,
    );
  }
  // (b) The manual city picker must be WIRED into the render (not orphaned).
  if (!/manualLocationOpen/.test(flowSrc)) {
    failures.push(
      `OnboardingFlow.tsx must have the \`manualLocationOpen\` state that reveals the manual city picker inline on the location step.`,
    );
  }
  // renderManualLocationPanel must be BOTH defined and INVOKED (≥2 occurrences:
  // the definition + at least one call site in a no-GPS branch).
  const panelMatches = flowSrc.match(/renderManualLocationPanel/g) || [];
  if (panelMatches.length < 2) {
    failures.push(
      `OnboardingFlow.tsx must define AND invoke renderManualLocationPanel() — the manual city picker must actually render on the location step (found ${panelMatches.length} occurrence(s), need >= 2).`,
    );
  }
  // handleManualLocation must be called from the render (manual pick advances).
  if (!/onPress=\{handleManualLocation\}/.test(flowSrc)) {
    failures.push(
      `OnboardingFlow.tsx must call handleManualLocation from the manual city picker (onPress={handleManualLocation}) so a manually-picked city advances into the app.`,
    );
  }
}

// ── FIX B: calendar/reminder purpose strings (iOS-17 keys) ───────────────────
function checkCalendarStrings(appJsonSrc, failures) {
  let parsed;
  try {
    parsed = JSON.parse(appJsonSrc);
  } catch (e) {
    failures.push(`app.json is not valid JSON: ${e.message}`);
    return;
  }

  // (a) expo-calendar plugin must NOT be a bare string (bare string → prebuild
  //     injects a GENERIC default for the iOS-17 keys, which Apple rejected).
  const plugins = parsed?.expo?.plugins;
  if (!Array.isArray(plugins)) {
    failures.push(`app.json expo.plugins is missing or not an array.`);
  } else {
    const bareCalendar = plugins.includes("expo-calendar");
    if (bareCalendar) {
      failures.push(
        `app.json expo-calendar plugin is a BARE STRING — prebuild injects a generic default for the iOS-17 calendar keys (Apple 5.1.1(ii) re-rejection). Use ["expo-calendar", { calendarPermission, remindersPermission }] with concrete text.`,
      );
    }
    const configured = plugins.find(
      (p) => Array.isArray(p) && p[0] === "expo-calendar",
    );
    if (!configured) {
      failures.push(
        `app.json must configure the expo-calendar plugin as ["expo-calendar", { calendarPermission, remindersPermission }].`,
      );
    } else {
      const cfg = configured[1] || {};
      for (const key of ["calendarPermission", "remindersPermission"]) {
        const v = cfg[key];
        if (typeof v !== "string" || !EXAMPLE_RE.test(v)) {
          failures.push(
            `app.json expo-calendar plugin ${key} must carry a concrete example (${EXAMPLE_RE}). Found: ${JSON.stringify(v)}.`,
          );
        }
      }
    }
  }

  // (b) Every calendar/reminder infoPlist key (old + iOS-17) must exist and
  //     carry a concrete example token.
  const ip = parsed?.expo?.ios?.infoPlist || {};
  for (const key of CALENDAR_KEYS) {
    const v = ip[key];
    if (typeof v !== "string" || v.length === 0) {
      failures.push(
        `app.json ios.infoPlist.${key} is missing/empty — every calendar/reminder key (old + iOS-17) must carry the concrete purpose string.`,
      );
      continue;
    }
    if (!EXAMPLE_RE.test(v)) {
      failures.push(
        `app.json ios.infoPlist.${key} lacks a concrete example (${EXAMPLE_RE}) — Apple 5.1.1(ii). Found: "${v}".`,
      );
    }
  }
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const self = [];

  // Good fixtures.
  const goodFlow = `
    const [manualLocationOpen, setManualLocationOpen] = useState(false)
    {launchCheckFailures >= 1 && (<Pressable onPress={handleLaunchGateProceedWithGps} />)}
    const renderManualLocationPanel = () => (<View><Pressable onPress={handleManualLocation} /></View>)
    {manualLocationOpen ? renderManualLocationPanel() : null}
  `;
  const goodCalDesc =
    "Mingla adds events you book or RSVP to — like a dinner reservation or a ticketed show — to your calendar. This is only used when you tap Add to Calendar.";
  const goodReminderDesc =
    "Mingla adds a reminder for an event you choose to save — like a dinner reservation or a ticketed show — so you get a heads-up. This is only used when you tap Add to Calendar.";
  const goodAppJson = JSON.stringify({
    expo: {
      plugins: [
        "expo-camera",
        [
          "expo-calendar",
          { calendarPermission: goodCalDesc, remindersPermission: goodReminderDesc },
        ],
      ],
      ios: {
        infoPlist: {
          NSCalendarsUsageDescription: goodCalDesc,
          NSCalendarsFullAccessUsageDescription: goodCalDesc,
          NSCalendarsWriteOnlyAccessUsageDescription: goodCalDesc,
          NSRemindersUsageDescription: goodReminderDesc,
          NSRemindersFullAccessUsageDescription: goodReminderDesc,
        },
      },
    },
  });

  // All-good must pass clean.
  let f = [];
  checkLocationNoGpsPath(goodFlow, f);
  if (f.length) self.push("good flow wrongly flagged: " + f.join("; "));
  f = [];
  checkCalendarStrings(goodAppJson, f);
  if (f.length) self.push("good app.json wrongly flagged: " + f.join("; "));

  // ── FIX A reverts ──
  // Revert: re-gate the escape behind >= 2.
  f = [];
  checkLocationNoGpsPath(
    goodFlow.replace("launchCheckFailures >= 1", "launchCheckFailures >= 2"),
    f,
  );
  if (f.length === 0)
    self.push("re-gating the location escape behind >= 2 was not flagged");

  // Revert: orphan the manual picker (define but never invoke).
  f = [];
  checkLocationNoGpsPath(
    `
    const [manualLocationOpen, setManualLocationOpen] = useState(false)
    {launchCheckFailures >= 1 && null}
    const renderManualLocationPanel = () => (<View><Pressable onPress={handleManualLocation} /></View>)
    `,
    f,
  );
  if (f.length === 0)
    self.push("orphaning renderManualLocationPanel (never invoked) was not flagged");

  // Revert: remove the handleManualLocation wiring.
  f = [];
  checkLocationNoGpsPath(
    goodFlow.replace("onPress={handleManualLocation}", "onPress={() => {}}"),
    f,
  );
  if (f.length === 0)
    self.push("removing the handleManualLocation render wiring was not flagged");

  // ── FIX B reverts ──
  // Revert: expo-calendar back to a bare string.
  f = [];
  checkCalendarStrings(
    goodAppJson.replace(
      JSON.stringify([
        "expo-calendar",
        { calendarPermission: goodCalDesc, remindersPermission: goodReminderDesc },
      ]),
      JSON.stringify("expo-calendar"),
    ),
    f,
  );
  if (f.length === 0)
    self.push("reverting expo-calendar to a bare string was not flagged");

  // Revert: drop the iOS-17 full-access key.
  f = [];
  const noFullAccess = JSON.parse(goodAppJson);
  delete noFullAccess.expo.ios.infoPlist.NSCalendarsFullAccessUsageDescription;
  checkCalendarStrings(JSON.stringify(noFullAccess), f);
  if (f.length === 0)
    self.push("dropping NSCalendarsFullAccessUsageDescription was not flagged");

  // Revert: vague calendar string (no concrete example).
  f = [];
  const vague = JSON.parse(goodAppJson);
  vague.expo.ios.infoPlist.NSCalendarsFullAccessUsageDescription =
    "Mingla needs calendar access to add scheduled experiences.";
  checkCalendarStrings(JSON.stringify(vague), f);
  if (f.length === 0)
    self.push("a vague calendar string (no concrete example) was not flagged");

  if (self.length) {
    console.error("ORCH-1230 consumer-apple-rejection-round2 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1230 consumer-apple-rejection-round2 self-test PASS (all PASS-on-fix + FAIL-on-revert cases).",
  );
  process.exit(0);
}

// ── LIVE RUN ─────────────────────────────────────────────────────────────────
const failures = [];

function readOrFail(p, label) {
  if (!fs.existsSync(p)) {
    failures.push(`${label} not found at ${p}.`);
    return null;
  }
  return fs.readFileSync(p, "utf8");
}

const flowSrc = readOrFail(ONBOARDING_FLOW, "OnboardingFlow.tsx");
if (flowSrc) checkLocationNoGpsPath(flowSrc, failures);

const appJsonSrc = readOrFail(APP_JSON, "app-mobile/app.json");
if (appJsonSrc) checkCalendarStrings(appJsonSrc, failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1230 I-PROPOSED-1230-CONSUMER-APPLE-REJECTION-ROUND2 FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1230 I-PROPOSED-1230-CONSUMER-APPLE-REJECTION-ROUND2 PASS — no-GPS manual city path reachable on first encounter (not gated >= 2), every calendar/reminder key (old + iOS-17) carries a concrete example, expo-calendar plugin is configured (not bare).",
);
