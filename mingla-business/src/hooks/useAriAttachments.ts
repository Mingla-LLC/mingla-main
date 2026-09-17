import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { Linking } from "react-native";

import { pickAriAttachmentFiles } from "../components/ari/ariAttachmentPicker";
import {
  AriAttachmentPickerPermissionError,
  type AriAttachmentSource,
} from "../components/ari/ariAttachmentPickerShared";
import {
  ARI_ATTACHMENT_MAX_FILES,
  ARI_ATTACHMENT_MAX_FILE_BYTES,
  ARI_ATTACHMENT_MAX_TURN_BYTES,
  type AriAttachmentDraft,
  discardAriAttachment,
  normalizePickedAriFile,
  prepareAriAttachments,
  stableFailure,
} from "../services/ariAttachmentService";
import {
  ariAttachmentSourceExists,
  readAriAttachmentSize,
} from "../services/ariAttachmentFileReader";
import { AriImagePreparationError, ariImageSourceKind } from "../services/ariImagePreparation";
import { prepareAriImage } from "../services/ariPrepareImage";
import { captureAriAttachmentOutcome } from "../services/ariPolishAnalytics";
import {
  existingAriAttachmentBytes,
  nextAriAttachmentBytes,
} from "../services/agentReliability";
import { randomId } from "../utils/randomId";

export interface UseAriAttachmentsResult {
  attachments: AriAttachmentDraft[];
  errorMessage: string | null;
  photoPermissionRecovery: { canOpenSettings: boolean } | null;
  clearError: () => void;
  openPhotoPermissionSettings: () => Promise<void>;
  addFiles: (source: AriAttachmentSource) => Promise<void>;
  retryAttachment: (localId: string) => Promise<void>;
  removeAttachment: (localId: string) => void;
  removeAll: () => void;
  allReady: boolean;
  canAttachMore: boolean;
  consumeReady: () => AriAttachmentDraft[] | null;
  restoreDrafts: (drafts: AriAttachmentDraft[]) => void;
}

export function useAriAttachments(args: {
  brandId: string | null;
  conversationId: string | null;
  surface: "main" | "website";
}): UseAriAttachmentsResult {
  const [attachments, setAttachments] = useState<AriAttachmentDraft[]>([]);
  const attachmentsRef = useRef<AriAttachmentDraft[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photoPermissionRecovery, setPhotoPermissionRecovery] = useState<{
    canOpenSettings: boolean;
  } | null>(null);
  const previousBrandId = useRef(args.brandId);

  const replaceAttachments = useCallback((next: AriAttachmentDraft[]): void => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const updateOne = useCallback((localId: string, patch: Partial<AriAttachmentDraft>): void => {
    setAttachments((current) => {
      const next = current.map((item) => item.localId === localId ? { ...item, ...patch } : item);
      attachmentsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (previousBrandId.current === args.brandId) return;
    const stale = attachmentsRef.current;
    previousBrandId.current = args.brandId;
    replaceAttachments([]);
    setErrorMessage(null);
    setPhotoPermissionRecovery(null);
    stale.forEach((item) => {
      if (item.attachmentId) void discardAriAttachment(item.attachmentId).catch(() => undefined);
    });
  }, [args.brandId, replaceAttachments]);

  const prepare = useCallback(async (drafts: AriAttachmentDraft[]): Promise<void> => {
    if (!args.brandId) {
      setErrorMessage("Choose a brand before attaching files.");
      drafts.forEach((draft) => updateOne(draft.localId, {
        state: "failed",
        errorCode: "BRAND_CONTEXT_REQUIRED",
        errorMessage: "Choose a brand before attaching files.",
      }));
      return;
    }
    await prepareAriAttachments({
      drafts,
      brandId: args.brandId,
      conversationId: args.conversationId,
      onUpdate: (localId, patch) => {
        updateOne(localId, patch);
        if (patch.state === "ready" || patch.state === "failed") {
          const file = attachmentsRef.current.find((item) => item.localId === localId);
          captureAriAttachmentOutcome({
            surface: args.surface,
            outcome: patch.state,
            fileType: file?.fileType ?? "unsupported",
            errorCode: patch.errorCode,
          });
        }
      },
    });
  }, [args.brandId, args.conversationId, args.surface, updateOne]);

  const failDraft = useCallback((draft: AriAttachmentDraft, code: string): void => {
    updateOne(draft.localId, {
      state: "failed",
      errorCode: code,
      errorMessage: stableFailure(code, draft.name),
    });
    if (code === "HEIC_NOT_SUPPORTED_IN_BROWSER") {
      // SC-R1-HEIC-METRIC: exactly one categorical event per refused file so
      // #3469 (an in-browser HEIC decoder) can be decided on real demand.
      captureAriAttachmentOutcome({
        surface: args.surface,
        outcome: "failed",
        fileType: "image",
        errorCode: code,
      });
    }
  }, [args.surface, updateOne]);

  /**
   * REWORK-1 section 3.1: images are re-encoded on this device or browser
   * (long edge <= 1,600 px) and documents get a real byte size before any
   * request. Returns the prepared draft, or null when the draft failed.
   */
  const prepareLocally = useCallback(async (draft: AriAttachmentDraft): Promise<AriAttachmentDraft | null> => {
    const original = draft.original;
    if (draft.fileType === "image" && original && ariImageSourceKind(original.name, original.mimeType)) {
      try {
        const prepared = await prepareAriImage({
          uri: original.uri,
          name: original.name,
          mimeType: original.mimeType,
          sizeBytes: original.size,
          width: original.width,
          height: original.height,
          webFile: original.webFile,
        });
        const patch: Partial<AriAttachmentDraft> = {
          uri: prepared.uri,
          name: prepared.name,
          mimeType: prepared.mimeType,
          sizeBytes: prepared.sizeBytes,
          prepared: true,
          ...(prepared.webFile ? { webFile: prepared.webFile } : {}),
        };
        updateOne(draft.localId, patch);
        return { ...draft, ...patch };
      } catch (error: unknown) {
        failDraft(draft, error instanceof AriImagePreparationError ? error.code : "IMAGE_UNREADABLE");
        return null;
      }
    }
    if (draft.sizeBytes > 0) return draft;
    const measured = await readAriAttachmentSize({ uri: draft.uri, webFile: draft.webFile });
    if (measured === null) {
      failDraft(draft, "UNREADABLE_FILE");
      return null;
    }
    updateOne(draft.localId, { sizeBytes: measured });
    return { ...draft, sizeBytes: measured };
  }, [failDraft, updateOne]);

  const addFiles = useCallback(async (source: AriAttachmentSource): Promise<void> => {
    setErrorMessage(null);
    setPhotoPermissionRecovery(null);
    const current = attachmentsRef.current;
    const remaining = ARI_ATTACHMENT_MAX_FILES - current.length;
    if (remaining <= 0) {
      setErrorMessage("You can attach up to 5 files and 25 MB in one message.");
      return;
    }
    let picked;
    try {
      picked = await pickAriAttachmentFiles(source, remaining);
    } catch (error: unknown) {
      if (error instanceof AriAttachmentPickerPermissionError) {
        setPhotoPermissionRecovery({ canOpenSettings: error.canOpenSettings });
        setErrorMessage("Photo access is off. Choose documents or allow photo access in Settings.");
      } else {
        setErrorMessage("Couldn’t open files. Try again.");
      }
      return;
    }
    if (picked.length === 0) return;
    const drafts: AriAttachmentDraft[] = [];
    for (const file of picked.slice(0, remaining)) {
      const draft = normalizePickedAriFile(file, randomId());
      if (draft.fileType === "unsupported") {
        draft.state = "failed";
        draft.errorCode = "UNSUPPORTED_TYPE";
        draft.errorMessage = stableFailure("UNSUPPORTED_TYPE", draft.name);
      }
      drafts.push(draft);
      captureAriAttachmentOutcome({
        surface: args.surface,
        outcome: "selected",
        fileType: draft.fileType,
      });
    }
    // Cards appear immediately as "Preparing…" while images are re-encoded.
    replaceAttachments([...current, ...drafts]);

    const localReady: AriAttachmentDraft[] = [];
    for (const draft of drafts) {
      if (draft.state !== "preparing") continue;
      const prepared = await prepareLocally(draft);
      if (prepared) localReady.push(prepared);
    }

    // Limits apply to prepared sizes, in selection order.
    let acceptedBytes = existingAriAttachmentBytes(current);
    const valid: AriAttachmentDraft[] = [];
    for (const draft of localReady) {
      if (!attachmentsRef.current.some((item) => item.localId === draft.localId)) continue;
      if (draft.sizeBytes > ARI_ATTACHMENT_MAX_FILE_BYTES) {
        failDraft(draft, "FILE_TOO_LARGE");
        continue;
      }
      if (acceptedBytes + draft.sizeBytes > ARI_ATTACHMENT_MAX_TURN_BYTES) {
        updateOne(draft.localId, {
          state: "failed",
          errorCode: "ATTACHMENT_LIMIT_EXCEEDED",
          errorMessage: "You can attach up to 5 files and 25 MB in one message.",
        });
        continue;
      }
      acceptedBytes = nextAriAttachmentBytes(acceptedBytes, draft);
      valid.push(draft);
    }
    if (valid.length > 0) await prepare(valid);
  }, [args.surface, failDraft, prepare, prepareLocally, replaceAttachments, updateOne]);

  const openPhotoPermissionSettings = useCallback(async (): Promise<void> => {
    try {
      await Linking.openSettings();
    } catch {
      setErrorMessage("Couldn’t open Settings. Choose documents instead.");
    }
  }, []);

  const clearError = useCallback((): void => {
    setErrorMessage(null);
    setPhotoPermissionRecovery(null);
  }, []);

  const removeAttachment = useCallback((localId: string): void => {
    const target = attachmentsRef.current.find((item) => item.localId === localId);
    if (!target) return;
    replaceAttachments(attachmentsRef.current.filter((item) => item.localId !== localId));
    captureAriAttachmentOutcome({
      surface: args.surface,
      outcome: "removed",
      fileType: target.fileType,
      errorCode: target.errorCode,
    });
    Haptics.selectionAsync().catch(() => undefined);
    if (target.attachmentId) void discardAriAttachment(target.attachmentId).catch(() => undefined);
  }, [args.surface, replaceAttachments]);

  const removeAll = useCallback((): void => {
    const current = attachmentsRef.current;
    replaceAttachments([]);
    current.forEach((item) => {
      captureAriAttachmentOutcome({
        surface: args.surface,
        outcome: "removed",
        fileType: item.fileType,
        errorCode: item.errorCode,
      });
      if (item.attachmentId) void discardAriAttachment(item.attachmentId).catch(() => undefined);
    });
  }, [args.surface, replaceAttachments]);

  const retryAttachment = useCallback(async (localId: string): Promise<void> => {
    const target = attachmentsRef.current.find((item) => item.localId === localId);
    if (!target) return;
    if (target.attachmentId) {
      // Best-effort: an undiscarded prepared row expires server-side in 24 h.
      await discardAriAttachment(target.attachmentId).catch(() => undefined);
    }
    const reset = { attachmentId: null, state: "preparing" as const, errorCode: null, errorMessage: null };
    // Reuse the already-prepared local copy; re-prepare only when it is gone
    // or was never produced.
    const reusable = target.prepared === true &&
      await ariAttachmentSourceExists({ uri: target.uri, webFile: target.webFile });
    if (reusable || (target.fileType !== "image" && target.sizeBytes > 0)) {
      const retry = { ...target, ...reset };
      updateOne(localId, retry);
      await prepare([retry]);
      return;
    }
    const original = target.original;
    const fresh = original
      ? { ...normalizePickedAriFile(original, localId), ...reset }
      : { ...target, ...reset };
    updateOne(localId, fresh);
    const prepared = await prepareLocally(fresh);
    if (!prepared) return;
    if (prepared.sizeBytes > ARI_ATTACHMENT_MAX_FILE_BYTES) {
      failDraft(prepared, "FILE_TOO_LARGE");
      return;
    }
    await prepare([prepared]);
  }, [failDraft, prepare, prepareLocally, updateOne]);

  const allReady = attachments.length === 0 || attachments.every((item) => item.state === "ready");
  const consumeReady = useCallback((): AriAttachmentDraft[] | null => {
    const current = attachmentsRef.current;
    if (current.some((item) => item.state !== "ready" || !item.attachmentId)) return null;
    replaceAttachments([]);
    return current;
  }, [replaceAttachments]);

  const restoreDrafts = useCallback((drafts: AriAttachmentDraft[]): void => {
    replaceAttachments(drafts.map((draft) => ({
      ...draft,
      state: "ready",
      errorCode: null,
      errorMessage: null,
    })));
  }, [replaceAttachments]);

  return {
    attachments,
    errorMessage,
    photoPermissionRecovery,
    clearError,
    openPhotoPermissionSettings,
    addFiles,
    retryAttachment,
    removeAttachment,
    removeAll,
    allReady,
    canAttachMore: attachments.length < ARI_ATTACHMENT_MAX_FILES,
    consumeReady,
    restoreDrafts,
  };
}
