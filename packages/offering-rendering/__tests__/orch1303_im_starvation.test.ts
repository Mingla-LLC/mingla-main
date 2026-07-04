// ORCH-1303 [rsvp-page-interactionmanager-starvation] — RsvpMomentumDecision
// InteractionManager-starvation regression (implementor-owned happy-path).
// Deno-runnable + dep-free: it reads the component SOURCE (no RN import) and drives
// a faithful model of the react-native-web Animated `isInteraction` rule, mirroring
// the committed real-engine probe `Mingla_Artifacts/evidence/ORCH-1303/im_starvation_probe.js`.
//
// Two layers, both FAIL-ON-REVERT (proven by true line-deletion in the report):
//   STRUCTURAL — both pulse-loop timings AND the meter-fill timing in
//     RsvpMomentumDecision.tsx carry `isInteraction: false`. Delete the flag from any
//     one → the matching assertion flips (T-3 in SPEC §7).
//   BEHAVIORAL — feed the ACTUAL pulse-timing config extracted from source into a
//     model of the RNW rule `__isInteraction = config.isInteraction ?? !shouldUseNativeDriver(config)`
//     (on web the native module is absent ⇒ shouldUseNativeDriver === false) plus a
//     tiny InteractionManager counter: the shipped (flagged) config DRAINS on web
//     (runAfterInteractions fires) and a flagless config STARVES (never fires). If the
//     flag is reverted, the extracted config drops it → the web-drain assertion flips
//     (T-1/T-2 in SPEC §7). Native (real native driver) drains either way (T-6).
//
// The model reproduces the exact engine lines cited by the investigation:
//   TimingAnimation.js:38   __isInteraction = config.isInteraction ?? !this._useNativeDriver
//   NativeAnimatedHelper.js shouldUseNativeDriver() => false on web (module absent)
//   AnimatedValue.js        createInteractionHandle() when __isInteraction; cleared only on END
//   InteractionManager      task queue drains only when the interaction set is empty
// A never-ending Animated.loop of interaction-flagged timings never reaches END, so the
// handle is held forever and the queue never drains — the ORCH-1303 web freeze.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const COMPONENT_RAW = await Deno.readTextFile(
  new URL("../RsvpMomentumDecision.tsx", import.meta.url),
);
// Strip comments before the config assertions: the fix comments legitimately NAME
// `isInteraction`/`useNativeDriver`/`Animated.loop` to explain WHY the flag is there;
// the invariant is about the RENDERED config, not the prose.
const COMPONENT = COMPONENT_RAW
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/\s+/g, " ");

// ─────────────────────── source extraction helpers ───────────────────────

/** From the index of a `{`, return the substring up to its matching `}`. */
function balancedBrace(s: string, openIdx: number): string {
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

/** The `{...}` config bodies of every Animated.timing(<varName>, {...}) in the source. */
function timingConfigs(varName: string): string[] {
  const configs: string[] = [];
  const re = new RegExp("Animated\\.timing\\s*\\(\\s*" + varName + "\\s*,", "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(COMPONENT)) !== null) {
    const braceIdx = COMPONENT.indexOf("{", m.index);
    if (braceIdx !== -1) configs.push(balancedBrace(COMPONENT, braceIdx));
  }
  return configs;
}

const hasFlag = (cfg: string) => /isInteraction\s*:\s*false/.test(cfg);
const hasNativeDriverTrue = (cfg: string) => /useNativeDriver\s*:\s*true/.test(cfg);

// ───────────────────── faithful RNW `isInteraction` model ─────────────────────

interface TimingConfig {
  useNativeDriver?: boolean;
  isInteraction?: boolean;
}

/** NativeAnimatedHelper.shouldUseNativeDriver: on web the native module is absent, so
 * a `useNativeDriver: true` request is nullified to false. Native keeps the request. */
function shouldUseNativeDriver(cfg: TimingConfig, platform: "web" | "native"): boolean {
  if (platform === "web") return false; // NativeAnimatedModule == null
  return cfg.useNativeDriver ?? false;
}

/** TimingAnimation: __isInteraction = config.isInteraction ?? !this._useNativeDriver. */
function computeIsInteraction(cfg: TimingConfig, platform: "web" | "native"): boolean {
  const useNative = shouldUseNativeDriver(cfg, platform);
  return cfg.isInteraction ?? !useNative;
}

/** Model an ENDLESS Animated.loop of `timings`: each interaction-flagged timing opens an
 * InteractionManager handle that (because the loop never ends) is never cleared. Returns
 * whether runAfterInteractions(cb) would EVER fire (queue drains ⇔ no handle held). */
function loopDrains(timings: TimingConfig[], platform: "web" | "native"): boolean {
  const heldHandles = timings.filter((t) => computeIsInteraction(t, platform)).length;
  return heldHandles === 0; // task queue drains only when the interaction set is empty
}

/** Parse the shipped pulse-loop config from SOURCE into model TimingConfig objects. */
function pulseTimingsFromSource(): TimingConfig[] {
  return timingConfigs("pulse").map((cfg) => ({
    useNativeDriver: hasNativeDriverTrue(cfg),
    ...(hasFlag(cfg) ? { isInteraction: false as const } : {}),
  }));
}

// ─────────────────────────── STRUCTURAL (fail-on-revert) ───────────────────────────

Deno.test("STRUCTURAL: both pulse-loop timings carry isInteraction:false", () => {
  const pulse = timingConfigs("pulse");
  assertEquals(pulse.length, 2, "expected exactly two pulse-loop Animated.timing configs");
  for (const cfg of pulse) {
    assert(
      hasFlag(cfg),
      "a pulse-loop timing is missing `isInteraction: false` — on web it would hold an " +
        "InteractionManager handle forever and starve runAfterInteractions. Config: " + cfg,
    );
    assert(hasNativeDriverTrue(cfg), "pulse timing should keep useNativeDriver:true (native path)");
  }
});

Deno.test("STRUCTURAL: meter-fill timing carries isInteraction:false", () => {
  const meter = timingConfigs("meterWidth");
  assertEquals(meter.length, 1, "expected exactly one meter-fill Animated.timing config");
  assert(
    hasFlag(meter[0]),
    "the meter-fill timing is missing `isInteraction: false` — useNativeDriver:false ⇒ " +
      "isInteraction defaults TRUE on every platform, transiently re-starving " +
      "runAfterInteractions on each going-count change. Config: " + meter[0],
  );
});

// ───────────────────────────── BEHAVIORAL (mirrors the probe) ─────────────────────────────

Deno.test("BEHAVIORAL control (probe parity): flagless loop STARVES on web, flagged loop DRAINS", () => {
  // CULPRIT — the pre-fix config (useNativeDriver:true, NO isInteraction).
  const culprit: TimingConfig[] = [{ useNativeDriver: true }, { useNativeDriver: true }];
  assertEquals(
    loopDrains(culprit, "web"),
    false,
    "flagless pulse loop must STARVE runAfterInteractions on web (the ORCH-1303 freeze)",
  );
  // FIX — add isInteraction:false.
  const fixed: TimingConfig[] = [
    { useNativeDriver: true, isInteraction: false },
    { useNativeDriver: true, isInteraction: false },
  ];
  assertEquals(
    loopDrains(fixed, "web"),
    true,
    "flagged pulse loop must DRAIN (runAfterInteractions fires) on web",
  );
});

Deno.test("BEHAVIORAL from SOURCE: the SHIPPED pulse config drains runAfterInteractions on web", () => {
  const shipped = pulseTimingsFromSource();
  assertEquals(shipped.length, 2);
  // With the flag present in source this is true; delete `isInteraction: false` from a
  // pulse timing (true line deletion) and computeIsInteraction => undefined ?? !false = true
  // => a handle is held => loopDrains === false => this assertion FLIPS (fails-on-revert).
  assertEquals(
    loopDrains(shipped, "web"),
    true,
    "the shipped RsvpMomentumDecision pulse loop must NOT hold a web InteractionManager handle",
  );
});

Deno.test("BEHAVIORAL parity (T-6): native drains regardless (real native driver ⇒ no JS handle)", () => {
  // Even the flagless config drains on native — the native module makes _useNativeDriver
  // true, so __isInteraction defaults false. The explicit flag makes web match native.
  const culprit: TimingConfig[] = [{ useNativeDriver: true }, { useNativeDriver: true }];
  assertEquals(loopDrains(culprit, "native"), true, "native is unaffected by the loop");
  assertEquals(loopDrains(pulseTimingsFromSource(), "native"), true, "shipped config drains on native too");
});
