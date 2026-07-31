// orch-strict-grep-allow safearea-on-fullscreen-routes — re-exports the event scanner route, which applies useSafeAreaInsets to every render state
// Issue #1447 — RSVP events reuse the existing event-scoped scanner manager.
// event_scanners is offering-type agnostic and the route reads the same [id].
export { default } from "../../../event/[id]/scanners/index";
