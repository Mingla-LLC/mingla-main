export const scheduleDayChooserFocusAfterNotice = (
  revealDayChooser: () => void,
): void => {
  globalThis.setTimeout(revealDayChooser, 0);
};

export const retryCanonicalDayTruth = async (
  refresh: () => Promise<boolean>,
  onSuccess: () => void,
  onFailure: () => void,
): Promise<boolean> => {
  try {
    const refreshed = await refresh();
    if (!refreshed) {
      onFailure();
      return false;
    }
    onSuccess();
    return true;
  } catch {
    onFailure();
    return false;
  }
};
