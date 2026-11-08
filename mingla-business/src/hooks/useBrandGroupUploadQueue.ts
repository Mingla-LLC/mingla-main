/**
 * #4304 — media speed (B). Owns the sender's own Brand-group uploads for one
 * thread: the queued → uploading → finalizing → complete | failed machine that
 * used to live inside BrandGroupFileUploadSheet (#3720), lifted to the thread
 * so the sheet can close at once and the files show in the conversation while
 * they send. Not a query hook: it reads nothing; it drives the existing
 * upload/finalize services and keeps their progress in component state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  setBrandGroupLocalPoster,
  setBrandGroupLocalPreview,
} from "../components/messages/brandGroupLocalPreviews";
import { generateBrandGroupVideoPoster } from "../components/messages/brandGroupVideoPoster";
import {
  finalizeBrandGroupFile,
  uploadPreparedBrandGroupFile,
  type PreparedBrandGroupFile,
} from "../services/brandGroupFilesService";
import {
  newBrandGroupPendingUpload,
  pruneDeliveredBrandGroupUploads,
  type BrandGroupPendingUpload,
} from "../utils/brandGroupPendingUploads";

export interface BrandGroupUploadQueue {
  uploads: BrandGroupPendingUpload[];
  enqueue: (prepared: PreparedBrandGroupFile[]) => Promise<void>;
  retry: (fileId: string) => void;
  dismiss: (fileId: string) => void;
}

export function useBrandGroupUploadQueue({
  messages,
  onUploaded,
}: {
  messages: readonly { file_id?: string | null }[];
  onUploaded: () => Promise<void> | void;
}): BrandGroupUploadQueue {
  const [uploads, setUploads] = useState<BrandGroupPendingUpload[]>([]);
  const preparedById = useRef(new Map<string, PreparedBrandGroupFile>());
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  // The server message replaces the pending item in the same render (see
  // visibleBrandGroupPendingUploads); this only forgets the delivered ones.
  useEffect(() => {
    setUploads((current) => pruneDeliveredBrandGroupUploads(current, messages));
  }, [messages]);

  const update = useCallback((fileId: string, patch: Partial<BrandGroupPendingUpload>): void => {
    setUploads((current) => current.map((item) => item.fileId === fileId ? { ...item, ...patch } : item));
  }, []);

  const transfer = useCallback(async (fileId: string, alreadyUploaded: boolean): Promise<void> => {
    const prepared = preparedById.current.get(fileId);
    if (!prepared) return;
    try {
      if (!alreadyUploaded) {
        update(fileId, { state: "uploading", error: null });
        await uploadPreparedBrandGroupFile(prepared, (progress) => update(fileId, { progress }));
        update(fileId, { uploaded: true, progress: 1, state: "finalizing" });
      } else {
        update(fileId, { state: "finalizing", error: null });
      }
      await finalizeBrandGroupFile(fileId);
      update(fileId, { state: "complete", progress: 1, uploaded: true });
      await onUploadedRef.current();
    } catch (cause) {
      update(fileId, {
        state: "failed",
        error: cause instanceof Error ? cause.message : "Couldn't share this file. Try again.",
      });
    }
  }, [update]);

  const enqueue = useCallback(async (prepared: PreparedBrandGroupFile[]): Promise<void> => {
    if (prepared.length === 0) return;
    const items = prepared.map((file) => {
      preparedById.current.set(file.fileId, file);
      return newBrandGroupPendingUpload({
        fileId: file.fileId,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        localUri: file.local.uri,
      });
    });
    for (const item of items) {
      setBrandGroupLocalPreview(item.fileId, { kind: item.kind, uri: item.localUri, poster: null });
      if (item.kind === "video") {
        // Fire and forget: a poster is a nicety and never holds the upload.
        void generateBrandGroupVideoPoster(item.localUri)
          .then((poster) => { if (poster) setBrandGroupLocalPoster(item.fileId, poster); })
          .catch((cause: unknown) => {
            console.warn("[#4304] local video poster skipped", cause instanceof Error ? cause.message : cause);
          });
      }
    }
    setUploads((current) => [...current, ...items]);
    for (const item of items) await transfer(item.fileId, false);
  }, [transfer]);

  const retry = useCallback((fileId: string): void => {
    const item = uploadsRef.current.find((upload) => upload.fileId === fileId);
    if (!item || item.state !== "failed") return;
    void transfer(fileId, item.uploaded);
  }, [transfer]);

  const dismiss = useCallback((fileId: string): void => {
    preparedById.current.delete(fileId);
    setUploads((current) => current.filter((item) => item.fileId !== fileId || item.state !== "failed"));
  }, []);

  return { uploads, enqueue, retry, dismiss };
}
