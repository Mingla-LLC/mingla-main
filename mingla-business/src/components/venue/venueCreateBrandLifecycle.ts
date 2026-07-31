interface VenueDraftBrandActivationInput {
  hydrated: boolean;
  currentBrandId: string | null;
  activeDraftBrandId: string | null;
}

interface VenueDraftBrandResetInput extends VenueDraftBrandActivationInput {
  hasPoolContext: boolean;
  workingName: string;
}

/**
 * Returns the current brand only when its draft still needs to be activated.
 * A null current brand is a loading/no-brand state, never a completed resume.
 */
export function venueDraftBrandToActivate({
  hydrated,
  currentBrandId,
  activeDraftBrandId,
}: VenueDraftBrandActivationInput): string | null {
  if (!hydrated || currentBrandId === null) return null;
  return activeDraftBrandId === currentBrandId ? null : currentBrandId;
}

/**
 * Returns the one brand whose empty draft may be cleared on normal venue entry.
 * Requiring current === active prevents a delayed hook from clearing a parked
 * draft, while returning the id (rather than a boolean) makes scoped reset the
 * only valid caller behavior.
 */
export function venueDraftBrandToReset({
  hydrated,
  currentBrandId,
  activeDraftBrandId,
  hasPoolContext,
  workingName,
}: VenueDraftBrandResetInput): string | null {
  if (
    !hydrated ||
    currentBrandId === null ||
    activeDraftBrandId !== currentBrandId ||
    hasPoolContext ||
    workingName.trim().length > 0
  ) {
    return null;
  }
  return currentBrandId;
}
