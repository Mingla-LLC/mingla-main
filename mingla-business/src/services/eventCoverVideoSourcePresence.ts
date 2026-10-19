/**
 * #3040 B-C11 [A-11] — can the prepared upload source still be read here?
 *
 * Web never keeps a durable source (the persisted record stores
 * `sourceUri: null`; a reload or unmount loses the blob), so web callers take
 * the re-pick path before asking. This stub answers "unknown → assume yes" so
 * no web path is ever blocked by it. The native sibling checks the file.
 */
export const preparedSourceStillExists = async (uri: string | null): Promise<boolean> =>
  typeof uri === "string" && uri.length > 0;
