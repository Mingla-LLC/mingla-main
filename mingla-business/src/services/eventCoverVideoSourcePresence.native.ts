/**
 * #3040 B-C11 [A-11] — the prepared copy lives in the OS cache directory,
 * which iOS and Android may purge while the app is away. Resuming from a file
 * that is gone can only fail, so the hook asks first and shows design state
 * H-12 ("Choose the video again") instead of a Resume button that never works.
 *
 * Lazy import: `expo-file-system`'s File API must never evaluate at boot
 * (orch-1296). A failed check reads as "gone" — the honest answer, because the
 * upload would fail to read it too.
 */
export const preparedSourceStillExists = async (uri: string | null): Promise<boolean> => {
  if (typeof uri !== "string" || uri.length === 0) return false;
  try {
    const { File } = await import("expo-file-system");
    return new File(uri).exists === true;
  } catch {
    return false;
  }
};
