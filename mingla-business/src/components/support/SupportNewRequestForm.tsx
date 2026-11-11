/**
 * #4382 Wave 4 — the Host app's new support request (journey 2, step 2).
 *
 * One form: topic, short summary, what happened, up to 10 screenshots and
 * the brand it is about (defaulting to the brand you are in). On Send each
 * screenshot is registered and uploaded to the private support-attachments
 * bucket against the request id, then issue_4382_create_customer_ticket
 * creates the request. The request id is kept across retries, and images
 * that already uploaded are not uploaded again, so a retry never makes a
 * second request.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { accent, glass, radius, semantic, spacing, text as textTokens } from "../../constants/designSystem";
import { useCreateSupportTicket } from "../../hooks/useSupportTickets";
import { useBrandList, useCurrentBrandId } from "../../store/currentBrandStore";
import { uploadSupportImage } from "../../services/supportService";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { SupportImageStrip } from "./SupportMedia";
import { hostSupportClientMeta } from "./supportClientMeta";
import { pickSupportImages, SupportPhotoAccessError } from "./supportImagePicker";
import {
  HOST_SUPPORT_TOPICS,
  MAX_SUPPORT_IMAGES,
  SUPPORT_DETAILS_MAX,
  SUPPORT_SUMMARY_MAX,
  addSupportImages,
  createSupportRequestId,
  supportCopy,
  type HostSupportTopic,
  type SupportImageRefusal,
  type SupportPickedImage,
} from "./supportRequestModel";

export interface SupportNewRequestFormProps {
  onCancel: () => void;
  onCreated: (ticketId: string) => void;
  onToast: (message: string) => void;
}

function refusalMessage(refusal: SupportImageRefusal): string {
  switch (refusal) {
    case "too_many":
      return supportCopy("form.too_many_images", { max: MAX_SUPPORT_IMAGES });
    case "too_large":
      return supportCopy("form.image_too_large");
    case "wrong_type":
      return supportCopy("form.image_type");
    default: {
      const exhaustive: never = refusal;
      return exhaustive;
    }
  }
}

export const SupportNewRequestForm: React.FC<SupportNewRequestFormProps> = ({
  onCancel,
  onCreated,
  onToast,
}) => {
  const brands = useBrandList();
  const currentBrandId = useCurrentBrandId();
  const { mutateAsync: createTicket } = useCreateSupportTicket();

  const [topic, setTopic] = useState<HostSupportTopic | null>(null);
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [images, setImages] = useState<SupportPickedImage[]>([]);
  const [brandId, setBrandId] = useState<string | null>(
    currentBrandId !== null && brands.some((brand) => brand.id === currentBrandId)
      ? currentBrandId
      : brands[0]?.id ?? null,
  );
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kept across retries: one request id, and the attachment id of every
  // image that already uploaded (keyed by its local uri).
  const requestIdRef = useRef<string>(createSupportRequestId());
  const uploadedRef = useRef<Map<string, string>>(new Map());

  const canSend =
    topic !== null && summary.trim().length > 0 && details.trim().length > 0 && !sending;

  const handleAddImages = useCallback(async (): Promise<void> => {
    try {
      const picked = await pickSupportImages(MAX_SUPPORT_IMAGES - images.length);
      if (picked.length === 0) return;
      const next = addSupportImages(images, picked);
      setImages(next.images);
      if (next.refusals.length > 0) onToast(refusalMessage(next.refusals[0]));
    } catch (err) {
      onToast(
        err instanceof SupportPhotoAccessError
          ? supportCopy("form.photo_access_off")
          : supportCopy("form.pick_failed"),
      );
    }
  }, [images, onToast]);

  const handleRemoveImage = useCallback((index: number): void => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async (): Promise<void> => {
    if (!canSend || topic === null) return;
    setSending(true);
    setError(null);
    try {
      const attachmentIds: string[] = [];
      setProgress(images.length > 0 ? { done: 0, total: images.length } : null);
      for (const [index, image] of images.entries()) {
        let attachmentId = uploadedRef.current.get(image.uri);
        if (attachmentId === undefined) {
          attachmentId = await uploadSupportImage(requestIdRef.current, image);
          uploadedRef.current.set(image.uri, attachmentId);
        }
        attachmentIds.push(attachmentId);
        setProgress({ done: index + 1, total: images.length });
      }
      const ticketId = await createTicket({
        clientRequestId: requestIdRef.current,
        topic,
        summary,
        details,
        attachmentIds,
        clientMeta: hostSupportClientMeta("account/support"),
        brandId,
      });
      onToast(supportCopy("form.sent"));
      onCreated(ticketId);
    } catch (err) {
      // A database refusal arrives as a code (not_brand_member, ...); people
      // get the plain sentence, the code stays in the log.
      const raw = err instanceof Error ? err.message : "";
      if (raw.length > 0) console.warn("[support] create request failed", raw);
      const message = raw.length > 0 && !/^[a-z0-9_]+$/.test(raw)
        ? raw
        : supportCopy("form.send_failed");
      setError(message);
      onToast(supportCopy("form.send_failed"));
    } finally {
      setSending(false);
      setProgress(null);
    }
  }, [canSend, topic, images, createTicket, summary, details, brandId, onToast, onCreated]);

  const hint = useMemo((): string | null => {
    if (sending) return null;
    if (topic === null) return supportCopy("form.pick_topic");
    if (summary.trim().length === 0) return supportCopy("form.need_summary");
    if (details.trim().length === 0) return supportCopy("form.need_details");
    return null;
  }, [sending, topic, summary, details]);

  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.lg}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>{supportCopy("form.title")}</Text>
        <Pressable
          onPress={onCancel}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={supportCopy("form.cancel")}
          hitSlop={8}
        >
          <Text style={[styles.cancel, sending && styles.disabledText]}>{supportCopy("form.cancel")}</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>{supportCopy("form.topic_label")}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {HOST_SUPPORT_TOPICS.map((key) => {
          const selected = topic === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTopic(key)}
              disabled={sending}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: sending }}
              accessibilityLabel={supportCopy(`topic.${key}`)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {supportCopy(`topic.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>{supportCopy("form.summary_label")}</Text>
      <TextInput
        value={summary}
        onChangeText={setSummary}
        placeholder={supportCopy("form.summary_placeholder")}
        placeholderTextColor={textTokens.tertiary}
        style={styles.subjectInput}
        maxLength={SUPPORT_SUMMARY_MAX}
        editable={!sending}
        accessibilityLabel={supportCopy("form.summary_label")}
        returnKeyType="next"
      />

      <Text style={styles.label}>{supportCopy("form.details_label")}</Text>
      <TextInput
        value={details}
        onChangeText={setDetails}
        placeholder={supportCopy("form.details_placeholder")}
        placeholderTextColor={textTokens.tertiary}
        style={[styles.subjectInput, styles.detailsInput]}
        maxLength={SUPPORT_DETAILS_MAX}
        editable={!sending}
        multiline
        textAlignVertical="top"
        accessibilityLabel={supportCopy("form.details_label")}
      />

      <Text style={styles.label}>{supportCopy("form.images_label")}</Text>
      <Text style={styles.hintSmall}>{supportCopy("form.images_hint", { max: MAX_SUPPORT_IMAGES })}</Text>
      <SupportImageStrip
        images={images}
        onAdd={() => void handleAddImages()}
        onRemove={handleRemoveImage}
        disabled={sending}
      />

      {brands.length > 0 ? (
        <>
          <Text style={styles.label}>{supportCopy("form.brand_label")}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {brands.map((brand) => {
              const selected = brandId === brand.id;
              return (
                <Pressable
                  key={brand.id}
                  onPress={() => setBrandId(brand.id)}
                  disabled={sending}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: sending }}
                  accessibilityLabel={brand.displayName}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                    {brand.displayName}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setBrandId(null)}
              disabled={sending}
              accessibilityRole="radio"
              accessibilityState={{ selected: brandId === null, disabled: sending }}
              accessibilityLabel={supportCopy("form.brand_none")}
              style={[styles.chip, brandId === null && styles.chipSelected]}
            >
              <Text style={[styles.chipText, brandId === null && styles.chipTextSelected]}>
                {supportCopy("form.brand_none")}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

      <View style={styles.sendRow}>
        <Button
          label={sending
            ? progress !== null && progress.done < progress.total
              ? supportCopy("form.uploading", { done: progress.done + 1, total: progress.total })
              : supportCopy("form.sending")
            : supportCopy("form.send")}
          leadingIcon="send"
          onPress={() => void handleSend()}
          loading={sending}
          disabled={!canSend}
        />
      </View>
      {hint !== null ? <Text style={styles.disabledHint}>{hint}</Text> : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
  },
  cancel: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
  disabledText: { opacity: 0.4 },
  label: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: textTokens.tertiary,
  },
  hintSmall: {
    marginBottom: spacing.sm,
    fontSize: 12,
    color: textTokens.tertiary,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    maxWidth: 220,
  },
  chipSelected: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  chipText: {
    fontSize: 13,
    color: textTokens.secondary,
  },
  chipTextSelected: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  subjectInput: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    overflow: "hidden",
    color: textTokens.primary,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    letterSpacing: 0,
  },
  detailsInput: {
    minHeight: 110,
    maxHeight: 220,
  },
  error: {
    marginTop: spacing.md,
    fontSize: 13,
    color: semantic.errorText,
  },
  sendRow: {
    marginTop: spacing.lg,
  },
  disabledHint: {
    marginTop: spacing.xs,
    textAlign: "center",
    color: textTokens.tertiary,
    fontSize: 12,
  },
});
