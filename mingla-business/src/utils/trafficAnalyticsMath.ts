export const visitToPaidRate = (
  bookings: number,
  pageViews: number,
): number | null =>
  pageViews > 0 ? Math.round((bookings / pageViews) * 1000) / 10 : null;

export const visibleDelta = (
  current: number,
  prior: number,
  currentThresholdCount: number,
  priorThresholdCount: number,
  threshold: number,
): number | null => {
  if (
    currentThresholdCount < threshold ||
    priorThresholdCount < threshold ||
    prior <= 0
  ) {
    return null;
  }
  return Math.round(((current - prior) / prior) * 1000) / 10;
};
