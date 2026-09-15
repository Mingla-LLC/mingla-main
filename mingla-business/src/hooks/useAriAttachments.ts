import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";

import {
  type AriAttachmentSource,
  pickAriAttachmentFiles,
} from "../components/ari/ariAttachmentPicker";
import {
  ARI_ATTACHMENT_MAX_FILES,
  ARI_ATTACHMENT_MAX_FILE_BYTES,
  ARI_ATTACHMENT_MAX_TURN_BYTES,
  type AriAttachmentDraft,
  discardAriAttachment,
  normalizePickedAriFile,
  prepareAriAttachments,
} from "../services/ariAttachmentService";
import { captureAriAttachmentOutcome } from "../services/ariPolishAnalytics";
import { randomId } from "../utils/randomId";

export interface UseAriAttachmentsResult {
  attachments: AriAttachmentDraft[];
  errorMessage: string | null;
  clearError: () => void;
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

  const addFiles = useCallback(async (source: AriAttachmentSource): Promise<void> => {
    setErrorMessage(null);
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
      setErrorMessage(error instanceof Error ? error.message : "Couldn’t open files. Try again.");
      return;
    }
    if (picked.length === 0) return;
    const existingBytes = current.reduce((sum, item) => sum + item.sizeBytes, 0);
    let acceptedBytes = existingBytes;
    const drafts: AriAttachmentDraft[] = [];
    for (const file of picked.slice(0, remaining)) {
      const draft = normalizePickedAriFile(file, randomId());
      if (draft.fileType === "unsupported") {
        draft.state = "failed";
        draft.errorCode = "UNSUPPORTED_TYPE";
        draft.errorMessage = "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.";
      }
      if (
        draft.state !== "failed" && (draft.sizeBytes < 1 || draft.sizeBytes > ARI_ATTACHMENT_MAX_FILE_BYTES ||
        acceptedBytes + draft.sizeBytes > ARI_ATTACHMENT_MAX_TURN_BYTES
        )
      ) {
        draft.state = "failed";
        draft.errorCode = draft.sizeBytes > ARI_ATTACHMENT_MAX_FILE_BYTES
          ? "FILE_TOO_LARGE"
          : "ATTACHMENT_LIMIT_EXCEEDED";
        draft.errorMessage = draft.sizeBytes > ARI_ATTACHMENT_MAX_FILE_BYTES
          ? "That file is larger than 10 MB. Choose a smaller file."
          : "You can attach up to 5 files and 25 MB in one message.";
      } else {
        acceptedBytes += draft.sizeBytes;
      }
      drafts.push(draft);
      captureAriAttachmentOutcome({
        surface: args.surface,
        outcome: "selected",
        fileType: draft.fileType,
      });
    }
    replaceAttachments([...current, ...drafts]);
    const valid = drafts.filter((draft) => draft.state === "preparing");
    if (valid.length > 0) await prepare(valid);
  }, [args.surface, prepare, replaceAttachments]);

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
      await discardAriAttachment(target.attachmentId).catch(() => undefined);
    }
    const retry = { ...target, attachmentId: null, state: "preparing" as const, errorCode: null, errorMessage: null };
    updateOne(localId, retry);
    await prepare([retry]);
  }, [prepare, updateOne]);

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
    clearError: () => setErrorMessage(null),
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
