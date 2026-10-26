/**
 * Issue #4114 QA run 3 — delete the picker's temp copies we no longer need.
 *
 * expo-image-picker writes every pick (the iPhone 720p H.264 video export,
 * camera captures, library photos) into `Caches/ImagePicker/`. A 60 s export
 * is up to 25 MB, so they are removed as soon as they are done with: after the
 * send is confirmed, after a cancelled upload, after a refused pick, and when
 * the item leaves the tray. Only files inside that folder are touched
 * (`isPickerTempFile`).
 */
import { isPickerTempFile } from '../utils/chatMedia';

export async function discardPickerTempFiles(uris: ReadonlyArray<string | null | undefined>): Promise<void> {
  const targets = uris.filter(isPickerTempFile);
  if (targets.length === 0) return;
  const FileSystem = await import('expo-file-system/legacy');
  await Promise.all(
    targets.map((uri) =>
      FileSystem.deleteAsync(uri, { idempotent: true }).catch((error: unknown) => {
        // Not user-facing: the OS clears Caches eventually. Logged so a leak is visible.
        console.warn('[chat-media] could not delete a picker temp file', error);
      }),
    ),
  );
}
