// ORCH-0964 — EventCover moved into the shared @mingla/offering-rendering package
// (it backs the shared EventCoverMedia fallback). Thin re-export preserves the
// existing `../ui/EventCover` import path.
export { EventCover } from "@mingla/offering-rendering";
