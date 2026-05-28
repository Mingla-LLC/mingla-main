// ORCH-0964 — EventCoverMedia moved into the shared @mingla/event-rendering
// package so the same image+GIF+video cover (web + native) backs mingla-business
// cards/public pages, app-mobile, AND the shared brand page. This file is a thin
// re-export to preserve the existing `../ui/EventCoverMedia` import path.
export { EventCoverMedia } from "@mingla/event-rendering";
export type {
  EventCoverMediaProps,
  EventCoverMediaErrorEvent,
} from "@mingla/event-rendering";
