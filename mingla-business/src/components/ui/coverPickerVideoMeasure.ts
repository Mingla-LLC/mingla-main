/**
 * #3040 B-C13b — web: there is no trimmer, so nothing is ever measured here.
 * The native sibling reads the trimmed output's real length.
 */
export const measureTrimmedVideoDurationMs = async (_uri: string): Promise<number | null> => null;
