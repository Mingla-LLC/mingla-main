// ORCH-1147R2 render-proof — expo-haptics stub (worktree-local, uncommitted).
// QuantityRow calls Haptics.selectionAsync() in its tap handlers; under jest
// there is no native haptics. Stub it as a resolved no-op. (Not exercised by
// the render assertions — they read text, not taps — but keeps the import safe.)
module.exports = {
  selectionAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
};
