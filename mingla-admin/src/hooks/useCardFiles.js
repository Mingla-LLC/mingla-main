// Issue #4255 (W3) — the browser side of a card's files: signed thumbnails,
// opening a file through a 5-minute signed link, and uploads that are checked
// before anything is sent and keep a failed file with Retry.
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../context/ToastContext";
import * as ops from "../services/opsService";
import { opsErrorWords, requestKey } from "../lib/opsModel";
import { fileKind, fileMime, fileProblem } from "../lib/workBoardModel";

/** Signed thumbnails for the pictures shown (5 minutes; read again when the list changes). */
export function useThumbnails(files) {
  const ids = useMemo(() => (Array.isArray(files) ? files : []).filter((f) => f?.kind === "image" && f.uploaded !== false).map((f) => f.id), [files]);
  const key = ids.join(",");
  const [urls, setUrls] = useState({});
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    (async () => {
      try {
        const signed = await Promise.all(key.split(",").map((id) => ops.signFile(id).then((s) => ({ id, s })).catch(() => null)));
        const rows = signed.filter((x) => x?.s?.path);
        const byPath = await ops.signedFileUrls(rows[0]?.s?.bucket || "ops-work-files", rows.map((x) => x.s.path), 300);
        if (live) setUrls(Object.fromEntries(rows.map((x) => [x.id, byPath[x.s.path] || ""])));
      } catch {
        if (live) setUrls({});
      }
    })();
    return () => { live = false; };
  }, [key]);
  return urls;
}

/** Open a file: a picture in the viewer, anything else in a new tab. */
export function useOpenFile() {
  const { addToast } = useToast();
  const [viewing, setViewing] = useState(null);
  const open = async (file) => {
    if (file.kind === "image") { setViewing(file); return; }
    if (file.kind === "link") { window.open(file.url, "_blank", "noopener,noreferrer"); return; }
    // Open the tab first (browsers block a tab opened after a wait), then point it at the signed link.
    const tab = window.open("", "_blank");
    try {
      const url = await ops.openableFileUrl(file.id);
      if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      tab?.close();
      addToast({ variant: "error", title: `Couldn’t open ${file.name}`, description: opsErrorWords(error) });
    }
  };
  return { open, viewing, close: () => setViewing(null) };
}

/**
 * Upload a list of files to a card. Each is checked before anything is sent
 * (type, 25 MB); a failed one stays in `pending` with Retry.
 */
export function useCardUploads(cardId, onDone) {
  const { addToast } = useToast();
  const [pending, setPending] = useState([]);
  const send = async (item) => {
    setPending((list) => list.map((p) => (p.key === item.key ? { ...p, state: "sending", error: "" } : p)));
    try {
      const row = await ops.uploadCardFile(cardId, item.file, { kind: fileKind(item.file), mime: fileMime(item.file), key: item.key });
      setPending((list) => list.filter((p) => p.key !== item.key));
      return row;
    } catch (error) {
      setPending((list) => list.map((p) => (p.key === item.key ? { ...p, state: "failed", error: opsErrorWords(error) } : p)));
      return null;
    }
  };
  const add = async (files) => {
    const items = [];
    for (const file of Array.from(files || [])) {
      const problem = fileProblem(file);
      if (problem) { addToast({ variant: "error", title: problem }); continue; }
      items.push({ key: requestKey("web_file"), file, state: "sending", error: "" });
    }
    if (!items.length) return [];
    setPending((list) => [...list, ...items]);
    const rows = await Promise.all(items.map(send));
    if (rows.some(Boolean)) onDone?.();
    if (rows.some((r) => !r)) addToast({ variant: "error", title: "A file didn’t upload", description: "Retry it from its chip, or remove it." });
    return rows.filter(Boolean);
  };
  const retry = async (item) => { const row = await send(item); if (row) onDone?.(); return row; };
  const drop = (item) => setPending((list) => list.filter((p) => p.key !== item.key));
  return { pending, add, retry, drop };
}

