// ORCH-0964 — EventCover moved into the shared @mingla/event-rendering package
// (it backs the shared EventCoverMedia fallback). Thin re-export preserves the
// existing `../ui/EventCover` import path.
export { EventCover } from "@mingla/event-rendering";
export type { EventCoverProps } from "@mingla/event-rendering";
