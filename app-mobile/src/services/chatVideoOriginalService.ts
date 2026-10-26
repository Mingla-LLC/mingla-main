/**
 * Issue #4114 QA run 2 — iPhone library videos: keep the original when the
 * 720p export came out larger.
 *
 * expo-image-picker returns only the exported (re-encoded) file. The original
 * is still reachable through its Photos asset id: expo-file-system's legacy
 * `copyAsync` accepts `ph://<assetId>` and streams the asset's video resource
 * into our cache. We copy it, read its size and container, and let the pure
 * `chooseChatVideoSource` decide. Whatever is not chosen is deleted.
 *
 * Any failure (no asset id, limited Photos access that does not cover the
 * asset, an iCloud-only original that does not arrive in time) falls back to
 * the export, which is always a valid 720p upload.
 */
import { Platform } from 'react-native';
import { chooseChatVideoSource, videoMimeFromHeader, type PickedChatMedia } from '../utils/chatMedia';

/** An iCloud-only original can need a download; never hold the tray longer than this. */
const ORIGINAL_COPY_TIMEOUT_MS = 8000;

export async function preferSmallerOriginalVideo(
  exported: PickedChatMedia,
  assetId: string | null | undefined,
): Promise<PickedChatMedia> {
  if (Platform.OS !== 'ios' || exported.kind !== 'video' || !assetId) return exported;

  const FileSystem = await import('expo-file-system/legacy');
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return exported;
  const safeId = assetId.replace(/[^A-Za-z0-9_-]/g, '_');
  const copyUri = `${cacheDir}chat-video-original-${safeId}-${Date.now()}`;
  const discardCopy = () =>
    FileSystem.deleteAsync(copyUri, { idempotent: true }).catch((error: unknown) => {
      console.warn('[chat-video] could not delete the original copy', error);
    });

  try {
    const copy = FileSystem.copyAsync({ from: `ph://${assetId}`, to: copyUri });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ORIGINAL_COPY_TIMEOUT_MS);
    });
    const outcome = await Promise.race([copy.then(() => 'copied' as const), timedOut]);
    if (timer) clearTimeout(timer);
    if (outcome === 'timeout') {
      // Let the copy finish in the background, then remove it.
      copy.then(discardCopy, discardCopy);
      return exported;
    }

    const exportInfo = await FileSystem.getInfoAsync(exported.uri);
    const originalInfo = await FileSystem.getInfoAsync(copyUri);
    const exportSize = exportInfo.exists && typeof exportInfo.size === 'number' ? exportInfo.size : exported.fileSize ?? null;
    const originalSize = originalInfo.exists && typeof originalInfo.size === 'number' ? originalInfo.size : null;

    const source = chooseChatVideoSource(
      { fileSize: exportSize, durationMs: exported.durationMs },
      { fileSize: originalSize, durationMs: exported.durationMs },
    );
    if (source === 'export') {
      await discardCopy();
      return exported;
    }

    const header = await FileSystem.readAsStringAsync(copyUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 12,
    });
    const mimeType = videoMimeFromHeader(header);
    if (!mimeType) {
      await discardCopy();
      return exported;
    }
    const extension = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    // AVFoundation (poster frame, player) reads the container from the extension.
    const finalUri = `${copyUri}.${extension}`;
    await FileSystem.moveAsync({ from: copyUri, to: finalUri });
    const baseName = (exported.fileName ?? 'video').replace(/\.[^.]*$/, '');
    return {
      ...exported,
      uri: finalUri,
      mimeType,
      fileName: `${baseName}.${extension}`,
      fileSize: originalSize,
    };
  } catch (error) {
    // Expected when Photos access does not cover this asset: send the export.
    console.warn('[chat-video] original not readable, sending the 720p export', error);
    await discardCopy();
    return exported;
  }
}
