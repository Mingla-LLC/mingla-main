import type { DraftEvent } from "../store/draftEventStore";

export interface DraftEditMeta {
  clientRevision: number;
  lastAcceptedServerRevision: number;
  dirty: boolean;
}

export const draftClientRevision = (
  draft: Pick<DraftEvent, "clientRevision"> | null | undefined,
): number => {
  const revision = draft?.clientRevision;
  return typeof revision === "number" && Number.isFinite(revision)
    ? revision
    : 0;
};

export const shouldApplyServerDraft = ({
  serverDraft,
  localDraft,
  editMeta,
}: {
  serverDraft: DraftEvent;
  localDraft: DraftEvent | null;
  editMeta: DraftEditMeta | null;
}): boolean => {
  const serverRevision = draftClientRevision(serverDraft);
  const localRevision = draftClientRevision(localDraft);
  if (serverRevision < localRevision) return false;
  if (editMeta?.dirty === true && serverRevision < editMeta.clientRevision) {
    return false;
  }
  return true;
};
