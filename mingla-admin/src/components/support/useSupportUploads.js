// #4382 Wave 2 — the uploader's state: add (paste, drop, picker), prepare
// (canvas re-encode), upload, retry and remove. One instance per composer or
// New ticket form; `ticketId` is the ticket, or the create call's request id
// while the ticket is still being written.
import { useCallback, useEffect, useRef, useState } from "react";
import { planAddFiles, reencodeImage, skippedMessage, uploadsBusy, uploadsReady } from "./supportUploadModel";
import { uploadSupportImage } from "../../services/supportDeskService";

let nextLocalId = 1;

export function useSupportUploads({ ticketId, isInternal = false }) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState("");
  const itemsRef = useRef(items);
  const mountedRef = useRef(true);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const patch = useCallback((localId, change) => {
    if (!mountedRef.current) return;
    setItems((current) => current.map((item) => (item.localId === localId ? { ...item, ...change } : item)));
  }, []);

  const run = useCallback(async (localId, file) => {
    patch(localId, { status: "preparing", progress: 0.05, error: null });
    try {
      const prepared = await reencodeImage(file);
      patch(localId, { status: "uploading", progress: 0.1, width: prepared.width, height: prepared.height });
      const attachmentId = await uploadSupportImage({
        ticketId,
        ...prepared,
        isInternal,
        onProgress: (value) => patch(localId, { progress: Math.max(0.1, value) }),
      });
      patch(localId, { status: "done", progress: 1, attachmentId });
    } catch (error) {
      patch(localId, { status: "error", progress: 0, error: error?.message || "The upload didn't finish." });
    }
  }, [ticketId, isInternal, patch]);

  const addFiles = useCallback((fileList) => {
    const { accepted, skipped } = planAddFiles(itemsRef.current.length, fileList);
    setNotice(skippedMessage(skipped));
    if (accepted.length === 0) return;
    const added = accepted.map((file) => ({
      localId: `u${nextLocalId++}`,
      file,
      name: file.name || "pasted-image.png",
      previewUrl: URL.createObjectURL(file),
      status: "preparing",
      progress: 0,
      error: null,
      attachmentId: null,
    }));
    itemsRef.current = [...itemsRef.current, ...added];
    setItems((current) => [...current, ...added]);
    for (const item of added) void run(item.localId, item.file);
  }, [run]);

  const retry = useCallback((localId) => {
    const item = itemsRef.current.find((entry) => entry.localId === localId);
    if (item) void run(localId, item.file);
  }, [run]);

  const remove = useCallback((localId) => {
    setItems((current) => {
      const gone = current.find((item) => item.localId === localId);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
    setNotice("");
  }, []);

  const clear = useCallback(() => {
    for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    setItems([]);
    setNotice("");
  }, []);

  /** Paste handler: takes image files out of the clipboard. */
  const onPaste = useCallback((event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.getAsFile())
      .filter(Boolean);
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  return {
    items,
    notice,
    addFiles,
    retry,
    remove,
    clear,
    onPaste,
    ready: uploadsReady(items),
    busy: uploadsBusy(items),
    attachmentIds: items.filter((item) => item.attachmentId && item.status === "done").map((item) => item.attachmentId),
  };
}
