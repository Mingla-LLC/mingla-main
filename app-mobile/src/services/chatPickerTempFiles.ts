/**
 * Issue #4114 QA run 3 — delete the picker's temp copies we no longer need.
 *
 * expo-image-picker writes every pick (the iPhone 720p H.264 video export,
 * camera captures, library photos) into `Caches/ImagePicker/`. A 60 s export
 * is up to 25 MB, so they are removed as soon as they are done with: after the
 * send is confirmed, after a cancelled upload, after a refused pick, and when
 * the item leaves the tray. Only files inside that folder are touched
 * (`isPickerTempFile`).
 *
 * Sim run 4 (item 3c): on iPhone the picker also leaves the original `.mov` it
 * copied before transcoding, and never returns its uri. So after every picker
 * step (a pick ends or is cancelled, a send is confirmed, an upload is
 * cancelled, a pick is refused, a tray item is removed, the chat is left) the
 * whole folder is swept on iOS: a file goes unless it is held by a tray item
 * or by an in-flight or failed upload (`holdPickerTempFiles`). No sweep runs
 * while a picker is open, because the picker is writing into the folder.
 * Android's picker returns the only copy it makes, so Android keeps the
 * per-uri deletes and is not swept.
 */
import { Platform } from 'react-native';
import { isPickerTempFile, selectPickerSweepTargets } from '../utils/chatMedia';

/** uri -> how many owners (tray, in-flight or failed upload) still need it. */
const heldUris = new Map<string, number>();
let openPickers = 0;
let sweepRequested = false;
let sweepRunning: Promise<void> | null = null;

/** A tray item or an upload still needs these files (its preview or a retry). */
export function holdPickerTempFiles(uris: ReadonlyArray<string | null | undefined>): void {
  for (const uri of uris) {
    if (!isPickerTempFile(uri)) continue;
    heldUris.set(uri, (heldUris.get(uri) ?? 0) + 1);
  }
}

/** One owner is done with these files; the next sweep may delete them. */
export function releasePickerTempFiles(uris: ReadonlyArray<string | null | undefined>): void {
  for (const uri of uris) {
    if (!isPickerTempFile(uri)) continue;
    const count = (heldUris.get(uri) ?? 0) - 1;
    if (count > 0) heldUris.set(uri, count);
    else heldUris.delete(uri);
  }
}

/**
 * Call before opening a picker; call the returned function when it closes
 * (picked, cancelled or failed). Closing sweeps the folder, so hold what the
 * pick added to the tray before closing.
 */
export function beginPickerSession(): () => void {
  openPickers += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    openPickers = Math.max(0, openPickers - 1);
    void sweepPickerTempFolder();
  };
}

/** Deletes every unheld file in `Caches/ImagePicker/` (iOS only). */
export async function sweepPickerTempFolder(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  sweepRequested = true;
  if (openPickers > 0) return; // swept when the picker closes
  if (sweepRunning) return sweepRunning; // the running sweep re-checks before it ends
  sweepRunning = (async () => {
    try {
      while (sweepRequested && openPickers === 0) {
        sweepRequested = false;
        await sweepOnce();
      }
    } finally {
      sweepRunning = null;
    }
  })();
  return sweepRunning;
}

async function sweepOnce(): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) return;
  const folderUri = `${cacheDirectory}${cacheDirectory.endsWith('/') ? '' : '/'}ImagePicker/`;
  let names: string[];
  try {
    const info = await FileSystem.getInfoAsync(folderUri);
    if (!info.exists || !info.isDirectory) return;
    names = await FileSystem.readDirectoryAsync(folderUri);
  } catch (error) {
    // Not user-facing: the OS clears Caches eventually. Logged so a leak is visible.
    console.warn('[chat-media] could not list the picker temp folder', error);
    return;
  }
  // A picker opened while the folder was being listed: leave it for that picker's close.
  if (openPickers > 0) {
    sweepRequested = true;
    return;
  }
  const targets = selectPickerSweepTargets(folderUri, names, heldUris.keys());
  await deleteQuietly(targets);
}

async function deleteQuietly(targets: ReadonlyArray<string>): Promise<void> {
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

/**
 * Deletes these picker temp copies (unless another owner still holds one),
 * then sweeps the folder for the copies the picker never returned.
 */
export async function discardPickerTempFiles(uris: ReadonlyArray<string | null | undefined>): Promise<void> {
  const targets = uris.filter(isPickerTempFile).filter((uri) => !heldUris.has(uri));
  await deleteQuietly(targets);
  await sweepPickerTempFolder();
}
