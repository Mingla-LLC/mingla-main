/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <TravelerIntakeAnswerCard />.
 *
 * Per DESIGN_ORCH-0880 §5.2. Collapsible "Intake form answers (N)" section
 * that mounts below the existing per-traveler contact block in the trip
 * dashboard Travelers tab.
 *
 * Renders Q+A pairs (Q in caption text.tertiary + A in body text.primary;
 * empty optional answers render as "—" in text.quaternary per Constitution
 * #9). Multi-choice answers render as comma-separated list. File answers
 * render via IntakeAnswerFileThumbnail in a horizontal wrap row (≤3 files)
 * or horizontal ScrollView (>3 files).
 *
 * Props receive the pre-resolved schema for the traveler's tier and the
 * order's intake_form_data answers payload. Parent (trip dashboard) handles
 * the schema + answers lookup.
 *
 * Composes Icon + IntakeAnswerFileThumbnail + IntakeAnswerFilePreview.
 * No new primitives.
 */

import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type {
  IntakeAnswerValue,
  IntakeFileAnswer,
  IntakeQuestion,
  IntakeSchema,
} from "../../services/intakeSchemaService";
import { IntakeAnswerFileThumbnail } from "./IntakeAnswerFileThumbnail";
import { IntakeAnswerFilePreview } from "./IntakeAnswerFilePreview";

export interface TravelerIntakeAnswerCardProps {
  schema: IntakeSchema | null;
  answers: Record<string, IntakeAnswerValue> | null;
  testID?: string;
}

const EMPTY_PLACEHOLDER = "—";

function formatAnswer(
  question: IntakeQuestion,
  value: IntakeAnswerValue | undefined,
): { kind: "text"; text: string } | { kind: "files"; files: IntakeFileAnswer[] } {
  if (value === undefined || value === null) {
    return { kind: "text", text: EMPTY_PLACEHOLDER };
  }
  switch (question.type) {
    case "short_text":
    case "long_text":
    case "single_choice":
    case "date":
    case "number":
      if (typeof value === "string" && value.trim().length > 0) {
        return { kind: "text", text: value };
      }
      return { kind: "text", text: EMPTY_PLACEHOLDER };
    case "multi_choice":
      if (Array.isArray(value) && value.length > 0) {
        const strings = value.filter((v): v is string => typeof v === "string");
        return { kind: "text", text: strings.join(", ") };
      }
      return { kind: "text", text: EMPTY_PLACEHOLDER };
    case "file_upload":
      if (Array.isArray(value) && value.length > 0) {
        const files = value.filter(
          (v): v is IntakeFileAnswer =>
            typeof v === "object" &&
            v !== null &&
            "path" in v &&
            "filename" in v,
        );
        return { kind: "files", files };
      }
      return { kind: "text", text: EMPTY_PLACEHOLDER };
    default: {
      // Exhaustive check.
      return { kind: "text", text: EMPTY_PLACEHOLDER };
    }
  }
}

export const TravelerIntakeAnswerCard: React.FC<
  TravelerIntakeAnswerCardProps
> = ({ schema, answers, testID }) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [previewFile, setPreviewFile] = useState<
    | { signedUrl: string; filename: string; sizeBytes: number }
    | null
  >(null);

  const questions = useMemo<IntakeQuestion[]>(() => {
    if (schema === null) return [];
    return [...schema.questions].sort((a, b) => a.position - b.position);
  }, [schema]);

  // Don't render anything when the trip has no schema for this tier.
  if (schema === null || questions.length === 0) return null;

  const answerMap = answers ?? {};
  const fileAnswerCount = questions.reduce<number>((acc, q) => {
    if (q.type !== "file_upload") return acc;
    const val = answerMap[q.id];
    if (Array.isArray(val)) return acc + val.length;
    return acc;
  }, 0);

  return (
    <View style={styles.container} testID={testID ?? "traveler-intake-card"}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Intake form answers, ${questions.length} ${questions.length === 1 ? "question" : "questions"}`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => [
          styles.header,
          pressed && styles.headerPressed,
        ]}
      >
        <Text style={styles.headerLabel}>
          INTAKE FORM ANSWERS ({questions.length})
        </Text>
        <Icon
          name={expanded ? "chevU" : "chevD"}
          size={18}
          color={textTokens.tertiary}
          strokeWidth={2}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {questions.map((q) => {
            const formatted = formatAnswer(q, answerMap[q.id]);
            return (
              <View key={q.id} style={styles.pairWrap}>
                <Text style={styles.questionLabel}>{q.label}</Text>
                {formatted.kind === "text" ? (
                  <Text
                    style={[
                      styles.answerText,
                      formatted.text === EMPTY_PLACEHOLDER &&
                        styles.answerEmpty,
                    ]}
                  >
                    {formatted.text}
                  </Text>
                ) : formatted.files.length <= 3 ? (
                  <View style={styles.filesRow}>
                    {formatted.files.map((f) => (
                      <IntakeAnswerFileThumbnail
                        key={f.path}
                        filePath={f.path}
                        filename={f.filename}
                        mimeType={f.mime_type}
                        sizeBytes={f.size_bytes}
                        onImageTap={(signedUrl) =>
                          setPreviewFile({
                            signedUrl,
                            filename: f.filename,
                            sizeBytes: f.size_bytes,
                          })
                        }
                      />
                    ))}
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filesRow}
                  >
                    {formatted.files.map((f) => (
                      <IntakeAnswerFileThumbnail
                        key={f.path}
                        filePath={f.path}
                        filename={f.filename}
                        mimeType={f.mime_type}
                        sizeBytes={f.size_bytes}
                        onImageTap={(signedUrl) =>
                          setPreviewFile({
                            signedUrl,
                            filename: f.filename,
                            sizeBytes: f.size_bytes,
                          })
                        }
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
            );
          })}
          {fileAnswerCount > 0 ? (
            <Text style={styles.filesHint}>
              Tap image to enlarge · Tap PDF to download
            </Text>
          ) : null}
        </View>
      ) : null}

      <IntakeAnswerFilePreview
        visible={previewFile !== null}
        signedUrl={previewFile?.signedUrl ?? null}
        filename={previewFile?.filename ?? ""}
        sizeBytes={previewFile?.sizeBytes ?? 0}
        onClose={() => setPreviewFile(null)}
      />
    </View>
  );
};

export interface TravelerTierChipProps {
  tierName: string;
  hidden?: boolean;
}

/**
 * Tier chip rendered top-right of the traveler card per DESIGN §5.1.
 * Hidden when the trip has only 1 tier (single-tier trips don't need tier
 * disambiguation). Parent decides hidden state.
 */
export const TravelerTierChip: React.FC<TravelerTierChipProps> = ({
  tierName,
  hidden = false,
}) => {
  if (hidden) return null;
  return (
    <View
      style={styles.tierChip}
      accessibilityLabel={`${tierName} traveler`}
    >
      <Text style={styles.tierChipLabel}>{tierName.toUpperCase()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    minHeight: 36,
  },
  headerPressed: {
    opacity: 0.7,
  },
  headerLabel: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    textTransform: "uppercase",
    color: textTokens.tertiary,
  },
  body: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  pairWrap: {
    gap: 2,
  },
  questionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  answerText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  answerEmpty: {
    color: textTokens.quaternary,
  },
  filesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  filesHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  tierChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    alignSelf: "flex-start",
  },
  tierChipLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
});

export default TravelerIntakeAnswerCard;
