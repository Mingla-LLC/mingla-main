// Issue #1447 — RSVP events reuse the existing event-scoped scanner manager.
// event_scanners is offering-type agnostic and the route reads the same [id].
export { default } from "../../../event/[id]/scanners/index";
