#!/usr/bin/env node
/**
 * ORCH-1303 [rsvp-page-interactionmanager-starvation] — strict-grep gate.
 *
 * WHY: on the RSVP public page the "kicker dot pulse" is an ENDLESS Animated.loop
 * inside packages/offering-rendering/RsvpMomentumDecision.tsx. Its timings set
 * useNativeDriver:true, but react-native-web has NO native animated module, so
 * shouldUseNativeDriver() returns false on web → each timing's __isInteraction
 * defaults to `config.isInteraction ?? !useNativeDriver` = TRUE. A never-ending
 * loop of interaction-flagged timings keeps an InteractionManager handle open
 * forever, so InteractionManager.runAfterInteractions(cb) NEVER drains page-wide
 * on web (proven in the real RNW engine — evidence/ORCH-1303/im_starvation_probe.js).
 * That is what froze the guest phone country-picker (ORCH-1299/1300). The meter
 * timing (useNativeDriver:false ⇒ __isInteraction TRUE on ALL platforms) re-holds
 * a ~500ms handle on every going-count change. The fix adds isInteraction:false to
 * the two pulse-loop timings AND the meter timing — scheduling-only, visually
 * identical, un-starving every runAfterInteractions consumer on the page at once.
 *
 * RULE (structural anti-recurrence, enforcing
 * I-PROPOSED-1303-RSVP-LOOP-NO-INTERACTION-HANDLE) — all must hold, else exit 1:
 *   A. In RsvpMomentumDecision.tsx, EVERY Animated.timing inside the pulse
 *      Animated.loop(...) carries `isInteraction: false`.
 *   B. In RsvpMomentumDecision.tsx, the meter-fill Animated.timing(meterWidth, {...})
 *      carries `isInteraction: false`.
 *   C. ADVERSARIAL — across the three RSVP shared-body files
 *      (RsvpMomentumDecision / RsvpOfferingBody / RsvpChipInPanel), EVERY
 *      Animated.timing/Animated.spring nested inside ANY Animated.loop(...) carries
 *      `isInteraction: false`. A new looping decorative animation added without the
 *      flag re-introduces the page-wide web starvation → FAIL.
 *
 * Comment-stripped before scanning: the rationale comments above and in the source
 * name `isInteraction`, `useNativeDriver`, and `Animated.loop`, so prose must not
 * satisfy or trip an assertion.
 *
 * Self-test: `node orch-1303-rsvp-loop-interaction-handle.mjs --self-test`
 * proves the fixed shape PASSES and each plausible revert (either pulse timing, the
 * meter timing, or a new loop timing dropping the flag) FAILS.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MOMENTUM_REL = "packages/offering-rendering/RsvpMomentumDecision.tsx";
const RSVP_BODY_RELS = [
  MOMENTUM_REL,
  "packages/offering-rendering/RsvpOfferingBody.tsx",
  "packages/offering-rendering/RsvpChipInPanel.tsx",
];

/** Strip block comments + whole-line `//` comments so prose can't satisfy/trip. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Collapse whitespace so a multi-line config object matches on one line. */
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** From the index of a `(`, return the substring up to its matching `)`. */
function balancedParen(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return s.slice(openIdx); // unbalanced — return the tail
}

/** From the index of a `{`, return the substring up to its matching `}`. */
function balancedBrace(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return s.slice(openIdx);
}

/** Every `Animated.loop(...)` region (balanced) in a normalized source string. */
function loopRegions(s) {
  const regions = [];
  const re = /Animated\.loop\s*\(/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const openIdx = s.indexOf("(", m.index);
    if (openIdx !== -1) regions.push(balancedParen(s, openIdx));
  }
  return regions;
}

/** Each `Animated.timing(` / `Animated.spring(` config object `{...}` inside a
 * region (returns the balanced brace body for each call). */
function animatedConfigs(region) {
  const configs = [];
  const re = /Animated\.(?:timing|spring)\s*\(/g;
  let m;
  while ((m = re.exec(region)) !== null) {
    const braceIdx = region.indexOf("{", m.index);
    if (braceIdx !== -1) configs.push(balancedBrace(region, braceIdx));
  }
  return configs;
}

const hasFlag = (cfg) => /isInteraction\s*:\s*false/.test(cfg);

/** Checks A + B — the two known sites in RsvpMomentumDecision.tsx. */
function scanMomentum(src) {
  const failures = [];
  const s = normalize(src);

  // A — every timing inside the pulse Animated.loop(...) carries the flag.
  const loops = loopRegions(s);
  if (loops.length === 0) {
    failures.push(
      "A: no Animated.loop(...) found in RsvpMomentumDecision.tsx — the kicker-dot " +
        "pulse loop moved or was removed; the gate can no longer prove it holds no " +
        "InteractionManager handle (ORCH-1303).",
    );
  } else {
    for (const loop of loops) {
      const cfgs = animatedConfigs(loop);
      if (cfgs.length === 0) {
        failures.push(
          "A: an Animated.loop(...) in RsvpMomentumDecision.tsx contains no " +
            "Animated.timing/spring config the gate can inspect (ORCH-1303).",
        );
      }
      for (const cfg of cfgs) {
        if (!hasFlag(cfg)) {
          failures.push(
            "A: a pulse-loop Animated.timing/spring is missing `isInteraction: false`. " +
              "On web (RNW nullifies useNativeDriver) this looping timing holds an " +
              "InteractionManager handle forever and starves runAfterInteractions " +
              "page-wide — the exact freeze ORCH-1303 fixed. Config: " +
              cfg.slice(0, 160),
          );
        }
      }
    }
  }

  // B — the meter-fill timing carries the flag.
  const meterIdx = s.indexOf("Animated.timing( meterWidth");
  const meterIdxAlt = s.indexOf("Animated.timing(meterWidth");
  const idx = meterIdx !== -1 ? meterIdx : meterIdxAlt;
  if (idx === -1) {
    failures.push(
      "B: could not locate the meter-fill Animated.timing(meterWidth, {...}) in " +
        "RsvpMomentumDecision.tsx — the site moved or was removed (ORCH-1303).",
    );
  } else {
    const braceIdx = s.indexOf("{", idx);
    const cfg = braceIdx === -1 ? "" : balancedBrace(s, braceIdx);
    if (!hasFlag(cfg)) {
      failures.push(
        "B: the meter-fill Animated.timing(meterWidth, {...}) is missing " +
          "`isInteraction: false`. useNativeDriver:false ⇒ isInteraction defaults TRUE " +
          "on every platform, so each going-count change re-holds a ~500ms " +
          "InteractionManager handle and transiently re-starves runAfterInteractions " +
          "(ORCH-1303). Config: " + cfg.slice(0, 160),
      );
    }
  }

  return failures;
}

/** Check C — adversarial: every timing/spring in ANY loop across the RSVP body
 * files carries the flag. `rel` is the file label for error messages. */
function scanBodyLoops(src, rel) {
  const failures = [];
  const s = normalize(src);
  for (const loop of loopRegions(s)) {
    for (const cfg of animatedConfigs(loop)) {
      if (!hasFlag(cfg)) {
        failures.push(
          `C: ${rel} adds a looping Animated.timing/spring without ` +
            "`isInteraction: false`. Any persistent looping decorative animation on " +
            "the RSVP shared body re-opens the web InteractionManager starvation " +
            "(runAfterInteractions never drains). Add isInteraction:false (ORCH-1303). " +
            "Config: " + cfg.slice(0, 160),
        );
      }
    }
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const PULSE = (flagA, flagB) => `
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true${flagA ? ", isInteraction: false" : ""} }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true${flagB ? ", isInteraction: false" : ""} }),
      ]),
    );
    loop.start();`;
  const METER = (flag) => `
    Animated.timing(meterWidth, {
      toValue: momentum.meterPercent,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,${flag ? "\n      isInteraction: false," : ""}
    }).start();`;
  const MOMENTUM = (a, b, meter) => PULSE(a, b) + "\n" + METER(meter);

  const check = (label, failures, expectFail, needle) => {
    const failed = failures.length > 0;
    if (expectFail && !failed) {
      console.error(`ORCH-1303 self-test FAIL: ${label} should have FAILED but passed.`);
      process.exit(1);
    }
    if (!expectFail && failed) {
      console.error(
        `ORCH-1303 self-test FAIL: ${label} should have PASSED but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
    if (expectFail && needle && !failures.some((f) => f.startsWith(needle))) {
      console.error(
        `ORCH-1303 self-test FAIL: ${label} failed but not on check ${needle}:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  // GOOD — both pulse timings + meter carry the flag: PASS.
  check("momentum GOOD", scanMomentum(MOMENTUM(true, true, true)), false);
  // BAD A1 — first pulse timing loses the flag: FAIL (A).
  check("momentum BAD_A1 (first pulse timing reverted)", scanMomentum(MOMENTUM(false, true, true)), true, "A:");
  // BAD A2 — second pulse timing loses the flag: FAIL (A).
  check("momentum BAD_A2 (second pulse timing reverted)", scanMomentum(MOMENTUM(true, false, true)), true, "A:");
  // BAD B — meter timing loses the flag: FAIL (B).
  check("momentum BAD_B (meter timing reverted)", scanMomentum(MOMENTUM(true, true, false)), true, "B:");

  // Adversarial C — a body file with a clean loop passes; a new flagless loop fails.
  const NO_LOOP = `export const RsvpOfferingBody = () => null;`;
  check("body no-loop GOOD", scanBodyLoops(NO_LOOP, "RsvpOfferingBody.tsx"), false);
  const NEW_LOOP_BAD = `
    const shimmer = Animated.loop(
      Animated.timing(glow, { toValue: 1, duration: 1200, useNativeDriver: false }),
    );
    shimmer.start();`;
  check("body new-loop BAD_C (flagless loop)", scanBodyLoops(NEW_LOOP_BAD, "RsvpChipInPanel.tsx"), true, "C:");
  const NEW_LOOP_OK = `
    const shimmer = Animated.loop(
      Animated.timing(glow, { toValue: 1, duration: 1200, useNativeDriver: false, isInteraction: false }),
    );
    shimmer.start();`;
  check("body new-loop GOOD (flagged loop)", scanBodyLoops(NEW_LOOP_OK, "RsvpChipInPanel.tsx"), false);

  console.log(
    "ORCH-1303 gate self-test PASS (8/8: fixed shape passes; each pulse timing, the " +
      "meter timing, and a flagless new loop each fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1303 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanMomentum(read(MOMENTUM_REL)),
  ...RSVP_BODY_RELS.flatMap((rel) => scanBodyLoops(read(rel), rel)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1303 gate FAIL — the RSVP momentum pulse loop / meter no longer proves it " +
      "holds no web InteractionManager handle:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nA looping/animating Animated.timing on the RSVP page WITHOUT " +
      "`isInteraction: false` starves InteractionManager.runAfterInteractions " +
      "page-wide on web (react-native-web nullifies useNativeDriver). Re-add " +
      "isInteraction:false to every pulse-loop + meter timing. See ORCH-1303.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1303 gate PASS — every RsvpMomentumDecision pulse-loop + meter Animated.timing " +
    "carries isInteraction:false; no flagless looping Animated in the RSVP shared body.",
);
