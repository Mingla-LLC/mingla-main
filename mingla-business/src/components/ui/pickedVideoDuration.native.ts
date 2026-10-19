export const readPickedVideoDurationMs = async (
  _uri: string,
  providedDurationMs?: number | null,
): Promise<number | null> =>
  typeof providedDurationMs === "number" &&
  Number.isFinite(providedDurationMs) &&
  providedDurationMs > 0
    ? Math.round(providedDurationMs)
    : null;
