/**
 * #4514 — the "Guest questions" row on the event, experience, trip and RSVP
 * edit screens (after Tickets, after Cover, after Intake form, after RSVP).
 * It shows what the page asks now and opens the shared attach sheet.
 *
 * Only an event manager or above sees it: the attach RPC needs that rank, and
 * a control that would be refused is never drawn (no dead taps). Loaded on
 * demand by each edit screen, so it stays out of the eager web bundle.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { useEventAttachment } from "../../hooks/useBrandForms";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import {
  canAttachGuestQuestions,
  rowSummary,
  type GuestQuestionsPageKind,
} from "../../utils/guestQuestionsModel";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { ATTACH_COPY } from "./brandFormsCopy";
import { FormRequestSheet } from "./FormRequestSheet";
import { GuestQuestionsSheet } from "./GuestQuestionsSheet";
import { useFormsToast } from "./useFormsToast";

export interface GuestQuestionsRowProps {
  eventId: string;
  brandId: string;
  kind: GuestQuestionsPageKind;
  testID?: string;
}

export const GuestQuestionsRow: React.FC<GuestQuestionsRowProps> = ({
  eventId,
  brandId,
  kind,
  testID = "guest-questions-row",
}) => {
  const role = useCurrentBrandRole(brandId);
  const allowed = canAttachGuestQuestions(role.rank);
  const query = useEventAttachment(eventId, allowed);
  const [open, setOpen] = useState<boolean>(false);
  // Wave 4 (§4.6, C12): "Ask earlier guests?" after a save on a page with guests.
  const [earlier, setEarlier] = useState<{
    formId: string;
    count: number;
    attachmentId: string;
    autoRemind: boolean;
    autoRemindChannels: Array<"sms" | "email">;
  } | null>(null);
  const { show, toast } = useFormsToast();

  const handlePress = useCallback((): void => {
    if (query.isError) {
      void query.refetch();
      return;
    }
    if (query.data === undefined) return;
    setOpen(true);
  }, [query]);

  if (!allowed) return null;

  const summary = rowSummary(
    {
      isError: query.isError,
      data:
        query.data === undefined
          ? undefined
          : query.data === null
            ? null
            : {
                formName: query.data.form.name,
                formStatus: query.data.form.status,
                published: query.data.form.liveVersionId !== null,
                mode: query.data.attachment.mode,
              },
    },
    kind,
  );

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${ATTACH_COPY.rowTitle}. ${summary}`}
        style={({ pressed }) => [pressed && styles.pressed]}
        testID={testID}
      >
        <GlassCard variant="base" radius="lg" padding={space[4]}>
          <View style={styles.inner}>
            <View style={styles.text}>
              <Text style={styles.title}>{ATTACH_COPY.rowTitle}</Text>
              <Text style={styles.line} numberOfLines={2}>
                {summary}
              </Text>
            </View>
            <Icon name="chevR" size={16} color={color.text3} />
          </View>
        </GlassCard>
      </Pressable>
      {open ? (
        <GuestQuestionsSheet
          visible
          onClose={() => setOpen(false)}
          brandId={brandId}
          eventId={eventId}
          kind={kind}
          onSaved={({ result, formId: savedFormId }) => {
            if (result.earlierGuests > 0) {
              setEarlier({
                formId: savedFormId,
                count: result.earlierGuests,
                attachmentId: result.attachmentId,
                autoRemind: result.autoRemind,
                autoRemindChannels: result.autoRemindChannels,
              });
            }
          }}
          current={query.data ?? null}
        />
      ) : null}
      {earlier !== null ? (
        <FormRequestSheet
          visible
          onClose={() => setEarlier(null)}
          formId={earlier.formId}
          eventId={eventId}
          mode="earlier"
          earlierCount={earlier.count}
          autoRemind={{ attachmentId: earlier.attachmentId, on: earlier.autoRemind, channels: earlier.autoRemindChannels }}
          notify={show}
        />
      ) : null}
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: space[3] },
  pressed: { opacity: 0.8 },
  inner: { flexDirection: "row", alignItems: "center", gap: space[3] },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.row, color: color.text1 },
  line: { ...type.caption, color: color.text3 },
});

export default GuestQuestionsRow;
