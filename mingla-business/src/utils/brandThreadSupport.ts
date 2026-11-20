/**
 * #4420 — the thread helpers (history paging + guarded send) as ONE lazy
 * module. brandThreadHistory.ts and brandThreadSend.ts stay the single owners
 * of their logic; this file only re-exports them so the Messages route and the
 * Guest chat panel (two chunks) reach them through one on-intent import()
 * (LazyGroupChatPanel.ensureMessagesEnglish) instead of each importing them
 * statically, which made the bundler hoist both into the eager web `__common`
 * chunk (bundle-baseline-movement).
 */
export * from "./brandThreadHistory";
export * from "./brandThreadSend";
