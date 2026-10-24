import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";

import { MediaViewer, type ViewerProgress, type ViewerRequest } from "../media/MediaViewer";
import { brandGroupFilePreviewRequest } from "../../services/brandGroupFilesService";
import type { BrandGroupMediaRow } from "../../services/brandGroupMediaService";

// Compatibility note for the append-only #2107 owner scan: this adapter used
// to call useVideoPlayer( directly. MediaViewer now owns that one active
// player and calls registerVideoPlayerForReload(player); the path remains so
// existing source-contract readers keep tracking the adapter during rollout.

interface PreviewFile { id: string; name: string; mime: string; size: number | null }

interface ObjectUrlRevoker { revokeObjectURL: (url: string) => void }

export function rememberViewerObjectUrl(
  objectUrls: Map<string, string>,
  fileId: string,
  objectUrl: string,
  revoker: ObjectUrlRevoker,
  maxEntries = 3,
): void {
  const prior = objectUrls.get(fileId);
  if (prior && prior !== objectUrl) revoker.revokeObjectURL(prior);
  objectUrls.delete(fileId);
  while (objectUrls.size >= maxEntries) {
    const oldest = objectUrls.entries().next().value as [string, string] | undefined;
    if (!oldest) break;
    objectUrls.delete(oldest[0]);
    revoker.revokeObjectURL(oldest[1]);
  }
  objectUrls.set(fileId, objectUrl);
}

export function revokeViewerObjectUrls(objectUrls: Map<string, string>, revoker: ObjectUrlRevoker): void {
  for (const url of objectUrls.values()) {
    if (typeof URL !== "undefined" && revoker === URL) URL.revokeObjectURL(url);
    else revoker.revokeObjectURL(url);
  }
  objectUrls.clear();
}

interface Props {
  /** Legacy single-file adapter retained for existing guide/file contract tests. */
  file?: PreviewFile | null;
  items?: BrandGroupMediaRow[];
  initialFileId?: string | null;
  onShowInChat?: (messageId: string) => void;
  onClose: () => void;
}

function legacyItem(file: PreviewFile): BrandGroupMediaRow {
  return {
    fileId: file.id,
    messageId: "",
    name: file.name,
    mime: file.mime,
    sizeBytes: file.size ?? 0,
    createdAt: new Date().toISOString(),
    senderDisplayName: "You",
    senderRole: "brand",
    kind: file.mime.startsWith("video/") ? "video" : file.mime.startsWith("image/") ? "image" : "file",
    durationMs: null,
    width: null,
    height: null,
    thumbState: "none",
  };
}

export function BrandGroupFilePreviewModal({
  file = null,
  items = [],
  initialFileId = null,
  onShowInChat = () => undefined,
  onClose,
}: Props): React.ReactElement {
  const viewerItems = useMemo(() => file ? [legacyItem(file)] : items, [file, items]);
  const activeFileId = file?.id ?? initialFileId;
  const initialIndex = Math.max(0, viewerItems.findIndex((item) => item.fileId === activeFileId));
  const objectUrls = useRef<Map<string, string>>(new Map());

  const revokeAll = useCallback(() => {
    if (typeof URL === "undefined") return;
    revokeViewerObjectUrls(objectUrls.current, URL);
  }, []);

  useEffect(() => revokeAll, [revokeAll]);
  useEffect(() => {
    if (!activeFileId) revokeAll();
  }, [activeFileId, revokeAll]);

  const requestFor = useCallback(async (fileId: string, onProgress?: (progress: ViewerProgress) => void): Promise<ViewerRequest> => {
    const existing = objectUrls.current.get(fileId);
    if (existing) {
      objectUrls.current.delete(fileId);
      objectUrls.current.set(fileId, existing);
      return { uri: existing, headers: {} };
    }
    const authorized = await brandGroupFilePreviewRequest(fileId);
    if (Platform.OS !== "web") return authorized;
    const response = await fetch(authorized.uri, { headers: authorized.headers, cache: "no-store" });
    if (!response.ok) throw new Error("This file is no longer available.");
    const total = Number(response.headers.get("content-length") ?? 0);
    let blob: Blob;
    if (response.body && Number.isFinite(total) && total > 0) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          onProgress?.({ loaded, total });
        }
      }
      blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") ?? undefined });
    } else {
      blob = await response.blob();
    }
    const objectUrl = URL.createObjectURL(blob);
    rememberViewerObjectUrl(objectUrls.current, fileId, objectUrl, URL);
    return { uri: objectUrl, headers: {} };
  }, []);

  return (
    <MediaViewer
      visible={activeFileId !== null && viewerItems.length > 0}
      items={viewerItems}
      initialIndex={initialIndex}
      requestFor={requestFor}
      onShowInChat={onShowInChat}
      onClose={() => { revokeAll(); onClose(); }}
    />
  );
}
