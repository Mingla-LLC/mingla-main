/*
 * ORCH-1303 mechanism probe — runs the REAL react-native-web Animated engine
 * (app-mobile/node_modules/react-native-web) in Node and reproduces the
 * InteractionManager starvation caused by the RsvpMomentumDecision pulse loop.
 *
 * It replicates the EXACT config at RsvpMomentumDecision.tsx:255-262:
 *   Animated.loop(Animated.sequence([
 *     Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
 *     Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
 *   ]))
 * with NO isInteraction — then reruns with isInteraction:false (the proposed fix).
 */

// rAF/cAF polyfill: RNW JS-driven timing uses global requestAnimationFrame.
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

const { Animated, InteractionManager } = require('react-native-web');

function runCase(label, extraTimingConfig, done) {
  const pulse = new Animated.Value(0);
  const mk = (toValue) =>
    Animated.timing(pulse, { toValue, duration: 900, useNativeDriver: true, ...extraTimingConfig });
  const loop = Animated.loop(Animated.sequence([mk(1), mk(0)]));

  loop.start();
  // After start(), the AnimatedValue holds the live TimingAnimation instance;
  // read its computed flags straight off the real engine.
  const probe = pulse._animation || {};

  let fired = false;
  const t0 = Date.now();
  InteractionManager.runAfterInteractions(() => { fired = true; });

  // Give it 3s (≈1.6 loop iterations) — far longer than one 900ms leg.
  setTimeout(() => {
    loop.stop();
    console.log(`\n[${label}]`);
    console.log(`  timing._useNativeDriver = ${probe._useNativeDriver}  (web => false: native module absent)`);
    console.log(`  timing.__isInteraction  = ${probe.__isInteraction}`);
    console.log(`  runAfterInteractions fired within ${Date.now() - t0}ms? => ${fired}`);
    done(fired, probe.__isInteraction);
  }, 3000);
}

console.log('=== ORCH-1303 InteractionManager starvation — real RNW engine, Node ===');
runCase('CULPRIT: loop timings, NO isInteraction (current RsvpMomentumDecision)', {}, (firedA) => {
  runCase('FIX: loop timings with isInteraction:false', { isInteraction: false }, (firedB) => {
    console.log('\n=== VERDICT ===');
    console.log(`  CULPRIT runAfterInteractions fired: ${firedA}  (expect false = STARVED)`);
    console.log(`  FIX     runAfterInteractions fired: ${firedB}  (expect true  = SETTLES)`);
    process.exit(firedA === false && firedB === true ? 0 : 1);
  });
});
