/**
 * #4238 B7 — one background upload for the Host ad media step.
 *
 * Renders nothing. It owns one `useEventCoverVideoUpload` on the existing
 * `ad_creative` lane with its own owner key, starts its file once, and reports
 * each stage up to the screen, so several clips upload and get ready side by
 * side while the Host keeps editing. The screen mounts slots at its root, so
 * changing steps never stops an upload.
 */
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { useEventCoverVideoUpload } from "../../../hooks/useEventCoverVideoUpload";
import { useNetInfoSafe } from "../../../lib/netinfoSafe";
import { resolveRawClipUploadUri } from "../../ui/coverPickerVideoTrimUpload";
import { hostAdUploadPhaseFor, type HostAdUploadItem } from "./hostAdMediaQueue";

export type HostAdUploadReport = {
  key: string;
  phase: HostAdUploadItem["phase"];
  percent: number | null;
  creativeId: string | null;
  canRetry: boolean;
  failure: HostAdUploadItem["failure"];
};

export function HostAdVideoUploadSlot(props: {
  brandId: string;
  item: HostAdUploadItem;
  /** Bumped by "Try again": the slot restarts the same file once per bump. */
  attempt: number;
  /** True once the Host removed the tile: the job is cancelled. */
  cancelled: boolean;
  onReport: (report: HostAdUploadReport) => void;
}): React.ReactElement | null {
  const { brandId, item, attempt, cancelled, onReport } = props;
  const network = useNetInfoSafe();
  const offlineRef = useRef(false);
  offlineRef.current = network?.isConnected === false;
  const upload = useEventCoverVideoUpload(
    "",
    brandId,
    "published_manual",
    "ad_creative",
    { draftOwnerKey: item.ownerKey },
    { isDeviceOffline: () => offlineRef.current },
  );
  const startedAttemptRef = useRef<number | null>(null);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const reportRef = useRef(onReport);
  reportRef.current = onReport;

  // Start (or restart after "Try again") the file exactly once per attempt.
  useEffect(() => {
    if (cancelled || startedAttemptRef.current === attempt) return;
    startedAttemptRef.current = attempt;
    const durationMs = Math.round(item.file.durationMs ?? 0);
    void uploadRef.current
      .start({
        uri: resolveRawClipUploadUri(item.file.uri, Platform.OS === "web"),
        fileName: item.file.fileName,
        mimeType: item.file.mimeType ?? "video/mp4",
        bytes: item.file.fileSize ?? 0,
        durationMs,
        trimStartMs: 0,
        trimEndMs: durationMs,
      })
      .catch(() => {
        // The hook moves its own stage to "error"; the report below says so.
      });
  }, [attempt, cancelled, item.file]);

  // A removed tile cancels its job (best effort; the server reaps leftovers).
  useEffect(() => {
    if (!cancelled) return;
    void uploadRef.current.cancel().catch(() => undefined);
  }, [cancelled]);

  const stage = upload.stage;
  const creativeId = upload.creativeId;
  const errorRetry = stage.phase === "error" ? stage.canRetry : undefined;
  useEffect(() => {
    if (cancelled) return;
    const read = hostAdUploadPhaseFor({ phase: stage.phase, percent: stage.percent, canRetry: errorRetry });
    // Ready means the server made the creative row: wait for its id.
    const phase = read.phase === "ready" && creativeId === null ? "preparing" : read.phase;
    reportRef.current({
      key: item.key,
      phase,
      percent: read.percent,
      creativeId: phase === "ready" ? creativeId : null,
      canRetry: read.canRetry,
      failure: phase === "failed" ? (stage.phase === "detached" || read.canRetry ? "network" : "file") : null,
    });
  }, [cancelled, creativeId, errorRetry, item.key, stage.percent, stage.phase]);

  return null;
}
