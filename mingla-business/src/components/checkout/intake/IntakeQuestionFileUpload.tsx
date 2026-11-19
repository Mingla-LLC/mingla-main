/**
 * #4514 — the trip intake FILE UPLOAD question, the one renderer that stays in
 * the business app (C11: the file picker stays here until brand-form file upload
 * ships). Moved unchanged from the deleted `IntakeQuestionRenderers.tsx`
 * (ORCH-0880); every other question type renders from `@mingla/form-rendering`.
 *
 * Wires expo-image-picker + expo-document-picker via IntakeFilePickerChooserSheet,
 * then calls the route's upload callback (intakeSchemaService.uploadIntakeFile).
 * Composes the business app's own GlassCard + Icon, so context-driven colours keep
 * flowing. No useAuth — anon-tolerant per `feedback_anon_buyer_routes.md`.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { IntakeQuestionShell } from "@mingla/form-rendering";

import { radius, color, space, type } from "../../../constants/designSystem";
import { GlassCard } from "../../ui/GlassCard";
import { Icon } from "../../ui/Icon";
import type {
  IntakeFileAnswer,
  IntakeQuestion,
} from "../../../services/intakeSchemaService";
import { IntakeFilePickerChooserSheet } from "./IntakeFilePickerChooserSheet";
import { businessFormPrimitives } from "./formRenderingPrimitives";

// ---------------------------------------------------------------------------
// IntakeQuestionFileUpload
// ---------------------------------------------------------------------------

export type UploadIntakeFile = (file: {
  questionId: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  body: Blob | ArrayBuffer | Uint8Array;
  replaceClaimId?: string;
}) => Promise<IntakeFileAnswer>;

export interface IntakeQuestionFileUploadProps {
  question: IntakeQuestion;
  error?: string;
  disabled?: boolean;
  value: IntakeFileAnswer[];
  onChange: (next: IntakeFileAnswer[]) => void;
  /** Upload callback the route wires to intakeSchemaService.uploadIntakeFile. */
  onUpload: UploadIntakeFile;
  onRemove: (claimId: string) => Promise<void>;
}

interface UploadingFile {
  tempId: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  body: Blob | ArrayBuffer | Uint8Array;
  status: "uploading" | "failed";
  errorMessage?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const IntakeQuestionFileUpload: React.FC<
  IntakeQuestionFileUploadProps
> = ({ question, value, onChange, error, disabled = false, onUpload, onRemove }) => {
  const maxFiles = question.max_files ?? 1;
  const allowImages = question.allow_images !== false;
  const allowPdfs = question.allow_pdfs !== false;
  const allowDocs = question.allow_docs !== false;

  const allowedTypesLabel = useMemo(() => {
    const parts: string[] = [];
    if (allowImages) parts.push("Images");
    if (allowPdfs) parts.push("PDFs");
    if (allowDocs) parts.push("docs");
    return parts.join(", ");
  }, [allowImages, allowPdfs, allowDocs]);

  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [removeArmed, setRemoveArmed] = useState<Record<string, boolean>>({});
  const [removeError, setRemoveError] = useState<string | null>(null);

  const handlePicked = useCallback(
    async (picked: {
      filename: string;
      mime_type: string;
      size_bytes: number;
      body: Blob | ArrayBuffer | Uint8Array;
    }): Promise<void> => {
      setPickerOpen(false);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setUploading((prev) => [
        ...prev,
        {
          tempId,
          filename: picked.filename,
          mime_type: picked.mime_type,
          size_bytes: picked.size_bytes,
          body: picked.body,
          status: "uploading",
        },
      ]);
      try {
        const result = await onUpload({
          ...picked,
          questionId: question.id,
          ...(maxFiles === 1 && value[0]?.claim_id
            ? { replaceClaimId: value[0].claim_id }
            : {}),
        });
        onChange(maxFiles === 1 ? [result] : [...value, result]);
        setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      } catch (e) {
        setUploading((prev) =>
          prev.map((u) =>
            u.tempId === tempId
              ? {
                  ...u,
                  status: "failed",
                  errorMessage:
                    e instanceof Error
                      ? e.message
                      : "Upload failed. Try again.",
                }
              : u,
          ),
        );
      }
    },
    [maxFiles, onUpload, onChange, question.id, value],
  );

  const handleRetry = useCallback(async (tempId: string): Promise<void> => {
    const pending = uploading.find((item) => item.tempId === tempId);
    if (pending === undefined) return;
    setUploading((prev) => prev.map((item) =>
      item.tempId === tempId
        ? { ...item, status: "uploading", errorMessage: undefined }
        : item
    ));
    try {
      const result = await onUpload({
        questionId: question.id,
        filename: pending.filename,
        mime_type: pending.mime_type,
        size_bytes: pending.size_bytes,
        body: pending.body,
        ...(maxFiles === 1 && value[0]?.claim_id
          ? { replaceClaimId: value[0].claim_id }
          : {}),
      });
      onChange(maxFiles === 1 ? [result] : [...value, result]);
      setUploading((prev) => prev.filter((item) => item.tempId !== tempId));
    } catch (retryFailure) {
      setUploading((prev) => prev.map((item) =>
        item.tempId === tempId
          ? {
            ...item,
            status: "failed",
            errorMessage: retryFailure instanceof Error
              ? retryFailure.message
              : "Upload failed. Try again.",
          }
          : item
      ));
    }
  }, [maxFiles, onChange, onUpload, question.id, uploading, value]);

  const handleRemoveTap = useCallback(
    (claimId: string): void => {
      if (!removeArmed[claimId]) {
        setRemoveError(null);
        setRemoveArmed({ [claimId]: true });
        return;
      }
      void onRemove(claimId).then(() => {
        onChange(value.filter((f) => f.claim_id !== claimId));
        setRemoveArmed({});
        setRemoveError(null);
      }).catch((removeFailure: unknown) => {
        setRemoveError(
          removeFailure instanceof Error
            ? removeFailure.message
            : "The file couldn’t be removed. Try again.",
        );
      });
    },
    [removeArmed, onChange, onRemove, value],
  );

  const totalCount = value.length + uploading.length;
  const canAdd = totalCount < maxFiles;

  return (
    <IntakeQuestionShell
      question={question}
      primitives={businessFormPrimitives}
      error={error ?? removeError ?? undefined}
    >
      {totalCount === 0 ? (
        <GlassCard variant="base" padding={space[6]} radius="lg">
          <View style={styles.uploadEmpty}>
            <View style={styles.uploadIconCircle}>
              <Icon
                name="upload"
                size={28}
                color={color.accent}
                strokeWidth={2}
              />
            </View>
            <Pressable
              onPress={() => !disabled && setPickerOpen(true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Choose a file to upload"
              hitSlop={8}
              style={({ pressed }) => [
                styles.uploadButton,
                pressed && !disabled && styles.choiceRowPressed,
                disabled && styles.textInputDisabled,
              ]}
            >
              <Text style={styles.uploadButtonLabel}>+ Choose file</Text>
            </Pressable>
            <Text style={styles.uploadHint}>
              Up to {maxFiles} {maxFiles === 1 ? "file" : "files"} · 10 MB each
            </Text>
            <Text style={styles.uploadHint}>{allowedTypesLabel} allowed</Text>
          </View>
        </GlassCard>
      ) : (
        <View style={styles.uploadFilled}>
          {value.map((file) => {
            const claimId = file.claim_id ?? "";
            const armed = removeArmed[claimId] === true;
            return (
              <GlassCard
                key={claimId}
                variant="base"
                padding={space[2]}
                radius="md"
              >
                <View style={styles.fileRow}>
                  <View style={styles.fileThumbWrap}>
                    <Icon
                      name="check"
                      size={20}
                      color={color.success}
                      strokeWidth={2.5}
                    />
                  </View>
                  <View style={styles.fileMain}>
                    <Text
                      style={styles.fileName}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      Uploaded file
                    </Text>
                    <Text style={styles.fileMeta}>
                      {formatBytes(file.size_bytes)} · uploaded
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveTap(claimId)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={
                      armed ? "Confirm remove file" : "Remove file"
                    }
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.fileRemove,
                      armed && styles.fileRemoveArmed,
                      pressed && styles.choiceRowPressed,
                    ]}
                  >
                    <Icon
                      name="close"
                      size={16}
                      color={
                        armed ? color.text1 : color.text3
                      }
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              </GlassCard>
            );
          })}
          {uploading.map((u) => (
            <GlassCard
              key={u.tempId}
              variant="base"
              padding={space[2]}
              radius="md"
            >
              <View
                style={[
                  styles.fileRow,
                  u.status === "failed" && styles.fileRowFailed,
                ]}
              >
                <View style={styles.fileThumbWrap}>
                  <Icon
                    name={u.status === "failed" ? "bell" : "upload"}
                    size={20}
                    color={
                      u.status === "failed"
                        ? color.danger
                        : color.text3
                    }
                    strokeWidth={2}
                  />
                </View>
                <View style={styles.fileMain}>
                  <Text
                    style={styles.fileName}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {u.filename}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {u.status === "uploading"
                      ? `${formatBytes(u.size_bytes)} · uploading…`
                      : `${u.errorMessage ?? "Upload failed"} · `}
                    {u.status === "failed" ? (
                      <Text
                        onPress={() => void handleRetry(u.tempId)}
                        style={styles.retryLink}
                      >
                        Retry
                      </Text>
                    ) : null}
                  </Text>
                </View>
              </View>
            </GlassCard>
          ))}
          {canAdd ? (
            <Pressable
              onPress={() => !disabled && setPickerOpen(true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Add another file"
              hitSlop={8}
              style={({ pressed }) => [
                styles.uploadButton,
                pressed && !disabled && styles.choiceRowPressed,
              ]}
            >
              <Text style={styles.uploadButtonLabel}>+ Add another file</Text>
            </Pressable>
          ) : (
            <Text style={styles.uploadHint}>
              Maximum {maxFiles} {maxFiles === 1 ? "file" : "files"} reached.
            </Text>
          )}
        </View>
      )}
      <IntakeFilePickerChooserSheet
        visible={pickerOpen}
        allowImages={allowImages}
        allowPdfs={allowPdfs}
        allowDocs={allowDocs}
        onPick={(picked) => {
          void handlePicked(picked);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </IntakeQuestionShell>
  );
};


const styles = StyleSheet.create({
  choiceRowPressed: {
    opacity: 0.7,
  },
  fileMain: {
    flex: 1,
  },
  fileMeta: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: 2,
  },
  fileName: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text1,
  },
  fileRemove: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  fileRemoveArmed: {
    backgroundColor: color.errorTint,
    borderWidth: 1,
    borderColor: color.danger,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  fileRowFailed: {
    opacity: 0.85,
  },
  fileThumbWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: color.fill.inset,
    alignItems: "center",
    justifyContent: "center",
  },
  retryLink: {
    color: color.accent,
    fontWeight: "600",
  },
  textInputDisabled: {
    opacity: 0.5,
  },
  uploadButton: {
    paddingVertical: space[2],
    paddingHorizontal: space[6],
    borderRadius: radius.full,
    backgroundColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  uploadButtonLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.textStrong,
  },
  uploadEmpty: {
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[2],
  },
  uploadFilled: {
    gap: space[1],
  },
  uploadHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    textAlign: "center",
  },
  uploadIconCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: color.accentLine,
    alignItems: "center",
    justifyContent: "center",
  },
});
