import type { DraftEvent } from "../store/draftEventStore";

export const isDraftEventPristine = (draft: DraftEvent): boolean =>
  draft.name.length === 0 &&
  draft.description.length === 0 &&
  // ORCH-0824: legacy `category` replaced by three taxonomy arrays. Draft
  // is pristine when all three are empty (no user picks yet).
  draft.partyTypes.length === 0 &&
  draft.vibeTags.length === 0 &&
  draft.musicGenres.length === 0 &&
  draft.date === null &&
  draft.doorsOpen === null &&
  draft.endsAt === null &&
  draft.venueName === null &&
  draft.address === null &&
  // ORCH-0824: new city + locationGeo fields are pristine when null.
  draft.city === null &&
  draft.locationGeo === null &&
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
