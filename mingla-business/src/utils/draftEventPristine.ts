import type { DraftEvent } from "../store/draftEventStore";

export const isDraftEventPristine = (draft: DraftEvent): boolean =>
  draft.name.length === 0 &&
  draft.description.length === 0 &&
  draft.category === null &&
  draft.date === null &&
  draft.doorsOpen === null &&
  draft.endsAt === null &&
  draft.venueName === null &&
  draft.address === null &&
  draft.onlineUrl === null &&
  draft.tickets.length === 0 &&
  draft.coverHue === 25 &&
  draft.coverMediaUrl === null &&
  draft.coverMediaType === null &&
  draft.format === "in_person" &&
  draft.visibility === "public" &&
  draft.requireApproval === false &&
  draft.allowTransfers === true &&
  draft.hideRemainingCount === false &&
  draft.passwordProtected === false;
