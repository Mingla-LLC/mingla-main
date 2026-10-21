import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { ScrollView } from "../../wrappers/SmartScrollView";

import { accent, glass, radius, semantic, spacing, text as textTokens } from "../../constants/designSystem";
import type { TicketStub } from "../../store/draftEventStore";
import type { TicketLinkRecord } from "../../services/ticketLinksService";
import { copyPublicUrl, sharePublicUrl } from "../../utils/sharePublicUrl";
import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { Input } from "../ui/Input";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { WebDateTimeInput } from "../ui/WebDateTimeInput";
import { TicketLinkRequestsSheet } from "./TicketLinkRequestsSheet";

const loadLinks = () => import("../../services/ticketLinksService");
type ExpiryPicker = "date" | "time" | null;

const defaultExpiry = (): Date => {
  const value = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  value.setMinutes(Math.ceil(value.getMinutes() / 15) * 15, 0, 0);
  return value;
};

const localDateTimeValue = (value: Date): string => {
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
};

const expiryLabel = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export interface TicketLinksSheetProps {
  visible: boolean;
  eventId: string;
  eventTitle: string;
  tickets: TicketStub[];
  initialTicketTypeId?: string | null;
  startCreating?: boolean;
  onClose(): void;
  onChanged?(): void;
}

const statePill = (state: TicketLinkRecord["state"]): { label: string; variant: "info" | "warn" | "draft" | "accent" } => {
  switch (state) {
    case "active": return { label: "ACTIVE", variant: "info" };
    case "full": return { label: "FULL", variant: "warn" };
    case "expired": return { label: "EXPIRED", variant: "draft" };
    case "revoked": return { label: "REVOKED", variant: "draft" };
    default: return { label: "PAUSED", variant: "warn" };
  }
};

export const TicketLinksSheet: React.FC<TicketLinksSheetProps> = ({
  visible,
  eventId,
  eventTitle,
  tickets,
  initialTicketTypeId = null,
  startCreating = false,
  onClose,
  onChanged,
}) => {
  const [links, setLinks] = useState<TicketLinkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TicketLinkRecord | null>(null);
  const [selectedTierId, setSelectedTierId] = useState(initialTicketTypeId ?? tickets[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [limited, setLimited] = useState(false);
  const [maxUses, setMaxUses] = useState("50");
  const [partyMax, setPartyMax] = useState(1);
  const [approvalMode, setApprovalMode] = useState<"auto" | "host">("auto");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expiryPicker, setExpiryPicker] = useState<ExpiryPicker>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<TicketLinkRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const linkableTickets = useMemo(
    () => tickets.filter((ticket) =>
      ticket.isFree || (ticket.priceGbp ?? 0) === 0 || ticket.visibility === "hidden"
    ),
    [tickets],
  );
  const selectedTier = linkableTickets.find((ticket) => ticket.id === selectedTierId) ?? null;
  const isFree = selectedTier?.isFree === true || (selectedTier?.priceGbp ?? 0) === 0;
  const pendingGroups = links.reduce((sum, link) => sum + link.pendingCount, 0);
  const pendingPeople = links.reduce((sum, link) => sum + link.pendingPeople, 0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const service = await loadLinks();
      setLinks(await service.listTicketLinks(eventId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load links.");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!visible) return;
    const requested = linkableTickets.find((ticket) => ticket.id === initialTicketTypeId);
    setSelectedTierId(requested?.id ?? linkableTickets[0]?.id ?? "");
    setCreating(startCreating);
    void refresh();
  }, [initialTicketTypeId, linkableTickets, refresh, startCreating, visible]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setCreated(null);
    setLabel("");
    setLimited(false);
    setMaxUses("50");
    setPartyMax(1);
    setApprovalMode("auto");
    setExpiresAt(null);
    setExpiryPicker(null);
  }, []);

  const beginEdit = useCallback((link: TicketLinkRecord) => {
    setEditing(link);
    setCreated(null);
    setSelectedTierId(link.ticketTypeId);
    setLabel(link.label);
    setLimited(link.maxUses !== null);
    setMaxUses(String(link.maxUses ?? 50));
    setPartyMax(link.partyMax);
    setApprovalMode(link.approvalMode);
    setExpiresAt(link.expiresAt);
    setExpiryPicker(null);
    setCreating(true);
  }, []);

  const submit = useCallback(async () => {
    if (label.trim().length === 0) {
      setError("Give the link a name.");
      return;
    }
    const parsedLimit = limited ? Number(maxUses) : null;
    if (limited && (!Number.isInteger(parsedLimit) || Number(parsedLimit) < 1 || Number(parsedLimit) > 5000)) {
      setError("Enter a limit from 1 to 5,000.");
      return;
    }
    if (expiresAt !== null && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      setError("Pick a time in the future.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const service = await loadLinks();
      if (editing) {
        await service.updateTicketLink(editing.id, {
          label: label.trim(),
          maxUses: parsedLimit,
          partyMax: isFree ? partyMax : 1,
          approvalMode: isFree ? approvalMode : "auto",
          expiresAt,
        });
        setToast("Link updated.");
        setCreating(false);
        resetForm();
      } else {
        const link = await service.createTicketLink({
          eventId,
          ticketTypeId: selectedTierId,
          eventDateId: null,
          label: label.trim(),
          maxUses: parsedLimit,
          partyMax: isFree ? partyMax : 1,
          approvalMode: isFree ? approvalMode : "auto",
          expiresAt,
        });
        setCreated(link);
      }
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save this link.");
    } finally {
      setSubmitting(false);
    }
  }, [approvalMode, editing, eventId, expiresAt, isFree, label, limited, maxUses, onChanged, partyMax, refresh, resetForm, selectedTierId]);

  const changeExpiry = useCallback((kind: Exclude<ExpiryPicker, null>) =>
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") setExpiryPicker(null);
      if (event.type === "dismissed" || selected === undefined) return;
      const next = expiresAt === null ? defaultExpiry() : new Date(expiresAt);
      if (kind === "date") {
        next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      } else {
        next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      }
      setExpiresAt(next.toISOString());
    }, [expiresAt]);

  const copy = useCallback(async (url: string) => {
    try {
      await copyPublicUrl(url);
      setToast("Link copied.");
    } catch {
      setToast("Couldn't copy the link.");
    }
  }, []);

  const share = useCallback(async (link: TicketLinkRecord) => {
    const description = link.kind === "guest_list"
      ? `You're invited to ${eventTitle}. Add your name to the guest list:`
      : `Here's your private link for ${eventTitle}:`;
    try {
      await sharePublicUrl({ title: eventTitle, url: link.url, description });
    } catch {
      await copy(link.url);
    }
  }, [copy, eventTitle]);

  const reset = useCallback((link: TicketLinkRecord) => {
    Alert.alert(
      "Reset this link?",
      "The current link stops working right away and you get a new one to share. Guests already on the list keep their tickets.",
      [
        { text: "Keep link", style: "cancel" },
        {
          text: "Reset link",
          onPress: () => {
            void (async () => {
              try {
                const service = await loadLinks();
                const next = await service.resetTicketLink(link.id);
                await copy(next.url);
                setToast("New link ready. Copy it to share.");
                await refresh();
              } catch (cause) {
                setToast(cause instanceof Error ? cause.message : "Couldn't reset this link.");
              }
            })();
          },
        },
      ],
    );
  }, [copy, refresh]);

  const revoke = useCallback((link: TicketLinkRecord) => {
    Alert.alert(
      `Revoke ${link.label}?`,
      "Nobody can use this link any more. People already on the list keep their tickets, and requests still waiting are declined.",
      [
        { text: "Keep link", style: "cancel" },
        {
          text: "Revoke link",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const service = await loadLinks();
                await service.revokeTicketLink(link.id);
                setToast("Link revoked.");
                await refresh();
                onChanged?.();
              } catch (cause) {
                setToast(cause instanceof Error ? cause.message : "Couldn't revoke this link.");
              }
            })();
          },
        },
      ],
    );
  }, [onChanged, refresh]);

  const content = useMemo(() => {
    if (loading && links.length === 0) return <Text style={styles.muted}>Loading links…</Text>;
    if (error && links.length === 0) return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Button label="Try again" variant="secondary" onPress={() => { void refresh(); }} />
      </View>
    );
    if (links.length === 0) return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No private links yet</Text>
        <Text style={styles.muted}>Make one for each DJ, promoter or friend so you can see who brought whom.</Text>
        <Button label="New link" leadingIcon="link" onPress={() => setCreating(true)} />
      </View>
    );
    return links.map((link) => {
      const status = statePill(link.state);
      return (
        <View key={link.id} style={styles.card} testID={`ticket-link-${link.id}`}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{link.label}</Text>
            <Pill variant={status.variant}>{status.label}</Pill>
          </View>
          <Text style={styles.muted}>{link.ticketTypeName} · {link.kind === "guest_list" ? "Guest list" : "Private ticket"}</Text>
          <Text style={styles.stat}>
            {link.kind === "guest_list"
              ? `${link.issuedPeople} on the list${link.usesLeft === null ? "" : ` · ${link.usesLeft} places left on this link`}${link.pendingCount > 0 ? ` · ${link.pendingCount} requests waiting (${link.pendingPeople} people)` : ""}`
              : `${link.paidTickets} tickets · ${link.paidOrders} orders${link.usesLeft === null ? "" : ` · ${link.usesLeft} left`}`}
            {link.expiresAt ? ` · Ends ${expiryLabel(link.expiresAt)}` : ""}
          </Text>
          {link.revokedAt ? <Text style={styles.muted}>This link no longer works.</Text> : (
            <View style={styles.actions}>
              <Button label="Copy link" size="sm" variant="secondary" onPress={() => { void copy(link.url); }} />
              <Button label="Share" size="sm" variant="secondary" onPress={() => { void share(link); }} />
              <IconChrome icon="moreH" size={36} onPress={() => beginEdit(link)} accessibilityLabel={`More actions for ${link.label}`} />
            </View>
          )}
          {!link.revokedAt ? (
            <View style={styles.smallActions}>
              <Pressable onPress={() => reset(link)} accessibilityRole="button"><Text style={styles.actionText}>Reset link</Text></Pressable>
              <Pressable onPress={() => revoke(link)} accessibilityRole="button"><Text style={styles.destructive}>Revoke link</Text></Pressable>
            </View>
          ) : null}
        </View>
      );
    });
  }, [beginEdit, copy, error, links, loading, refresh, reset, revoke, share]);

  return (
    <>
      <Sheet visible={visible} onClose={onClose} snapPoint="full" dismissDisabled={submitting} testID="ticket-links-sheet">
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{creating ? (editing ? "Edit link" : "New link") : "Private links"}</Text>
            <Text style={styles.muted}>{creating ? "Anyone with the link can use it until you reset or revoke it." : "Make a link for a ticket type and share it. Free types become guest-list sign-up links; paid types become private tickets."}</Text>
          </View>
          <IconChrome icon="close" size={36} onPress={creating ? () => { setCreating(false); resetForm(); } : onClose} accessibilityLabel="Close" />
        </View>

        {pendingGroups > 0 && !creating ? (
          <View style={styles.pending}>
            <Text style={styles.pendingText}>{pendingGroups === 1 ? "1 request waiting for approval" : `${pendingGroups} requests waiting for approval`} · {pendingPeople} people</Text>
            <Button label="Review" size="sm" variant="secondary" onPress={() => setReviewOpen(true)} />
          </View>
        ) : null}

        {creating ? (
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            {created ? (
              <View style={styles.createdCard}>
                <Text style={styles.emptyTitle}>Link ready</Text>
                <Text selectable style={styles.url}>{created.url}</Text>
                <View style={styles.actions}>
                  <Button label="Copy link" onPress={() => { void copy(created.url); }} />
                  <Button label="Share" variant="secondary" onPress={() => { void share(created); }} />
                </View>
                <Text style={styles.muted}>Anyone with this link can use it. Reset or revoke it any time.</Text>
                <Button label="Done" variant="ghost" onPress={() => { setCreating(false); resetForm(); }} />
              </View>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Ticket type</Text>
                <View style={styles.choices}>
                  {linkableTickets.map((ticket) => (
                    <Pressable
                      key={ticket.id}
                      disabled={editing !== null}
                      onPress={() => setSelectedTierId(ticket.id)}
                      accessibilityRole="radio"
                      accessibilityLabel={`${ticket.name}, ${ticket.isFree || (ticket.priceGbp ?? 0) === 0 ? "guest list" : "private ticket"}`}
                      accessibilityState={{ selected: selectedTierId === ticket.id, disabled: editing !== null }}
                      style={[styles.choice, selectedTierId === ticket.id && styles.choiceActive]}
                    >
                      <Text style={styles.choiceText}>{ticket.name}</Text>
                      <Text style={styles.muted}>{ticket.isFree || (ticket.priceGbp ?? 0) === 0 ? "Guest list" : "Private ticket"}{ticket.visibility === "hidden" ? " · Hidden" : " · Public"}</Text>
                    </Pressable>
                  ))}
                </View>
                {selectedTier?.visibility !== "hidden" ? <Text style={styles.helper}>Free guest-list links may use a public ticket type. Paid private links require a hidden type.</Text> : null}
                <Text style={styles.fieldLabel}>Link name</Text>
                <Input value={label} onChangeText={setLabel} placeholder="DJ Kaycee's invites" accessibilityLabel="Link name" />

                <Pressable style={styles.toggleRow} onPress={() => setLimited((value) => !value)} accessibilityRole="switch" accessibilityLabel={isFree ? "Limit sign-ups on this link" : "Limit tickets on this link"} accessibilityState={{ checked: limited }}>
                  <Text style={styles.choiceText}>{isFree ? "Limit sign-ups on this link" : "Limit tickets on this link"}</Text>
                  <Text style={styles.actionText}>{limited ? "ON" : "OFF"}</Text>
                </Pressable>
                {limited ? <Input value={maxUses} onChangeText={setMaxUses} placeholder="50" variant="number" accessibilityLabel="How many people" /> : null}
                <Text style={styles.helper}>Counts each person, including guests. The ticket type’s own capacity still applies.</Text>

                {isFree ? (
                  <>
                    <Text style={styles.fieldLabel}>Guests can bring</Text>
                    <View style={styles.choicesRow}>
                      {[1, 2, 4, 10].map((value) => (
                        <Pressable key={value} style={[styles.chip, partyMax === value && styles.choiceActive]} onPress={() => setPartyMax(value)} accessibilityRole="radio" accessibilityLabel={value === 1 ? "No guests" : `Guests can bring up to ${value - 1}`} accessibilityState={{ selected: partyMax === value }}>
                          <Text style={styles.choiceText}>{value === 1 ? "No guests" : `Up to ${value - 1}`}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.helper}>Each guest gives their own name, email and phone, and gets their own ticket. Every person counts toward the limit.</Text>
                    <Pressable style={styles.toggleRow} onPress={() => setApprovalMode((mode) => mode === "auto" ? "host" : "auto")} accessibilityRole="switch" accessibilityLabel="Approve each request" accessibilityState={{ checked: approvalMode === "host" }}>
                      <View style={styles.headerText}>
                        <Text style={styles.choiceText}>Approve each request</Text>
                        <Text style={styles.helper}>Requests hold no places until you approve them.</Text>
                      </View>
                      <Text style={styles.actionText}>{approvalMode === "host" ? "ON" : "OFF"}</Text>
                    </Pressable>
                  </>
                ) : null}

                <Text style={styles.fieldLabel}>Link stops working</Text>
                <View style={styles.choicesRow} accessibilityRole="radiogroup">
                  <Pressable
                    style={[styles.choice, styles.expiryChoice, expiresAt === null && styles.choiceActive]}
                    onPress={() => { setExpiresAt(null); setExpiryPicker(null); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: expiresAt === null }}
                  >
                    <Text style={styles.choiceText}>When the event ends</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.choice, styles.expiryChoice, expiresAt !== null && styles.choiceActive]}
                    onPress={() => setExpiresAt((current) => current ?? defaultExpiry().toISOString())}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: expiresAt !== null }}
                  >
                    <Text style={styles.choiceText}>At a set time</Text>
                  </Pressable>
                </View>
                {expiresAt !== null ? Platform.OS === "web" ? (
                  <WebDateTimeInput
                    type="datetime-local"
                    value={localDateTimeValue(new Date(expiresAt))}
                    min={localDateTimeValue(new Date())}
                    ariaLabel="Link expiry date and time"
                    testID="ticket-link-expiry-web"
                    onChangeValue={(value) => {
                      if (value.length === 0) return;
                      const next = new Date(value);
                      if (Number.isFinite(next.getTime())) setExpiresAt(next.toISOString());
                    }}
                  />
                ) : (
                  <View style={styles.expiryNative}>
                    <View style={styles.choicesRow}>
                      <Button label={new Date(expiresAt).toLocaleDateString()} variant="secondary" onPress={() => setExpiryPicker("date")} />
                      <Button label={new Date(expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} variant="secondary" onPress={() => setExpiryPicker("time")} />
                    </View>
                    {expiryPicker !== null ? (
                      <>
                        <DateTimePicker
                          value={new Date(expiresAt)}
                          mode={expiryPicker}
                          display={Platform.OS === "ios" ? "spinner" : "default"}
                          minimumDate={expiryPicker === "date" ? new Date() : undefined}
                          onChange={changeExpiry(expiryPicker)}
                          themeVariant="dark"
                        />
                        {Platform.OS === "ios" ? <Button label="Done" variant="ghost" onPress={() => setExpiryPicker(null)} /> : null}
                      </>
                    ) : null}
                  </View>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button label={editing ? "Save changes" : "Create link"} loading={submitting} disabled={submitting || selectedTierId.length === 0} fullWidth onPress={() => { void submit(); }} />
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Button label="New link" leadingIcon="link" onPress={() => { resetForm(); setCreating(true); }} />
            {content}
          </ScrollView>
        )}
        {toast ? <Text accessibilityLiveRegion="polite" style={styles.toast}>{toast}</Text> : null}
      </Sheet>
      <TicketLinkRequestsSheet
        visible={reviewOpen}
        eventId={eventId}
        onClose={() => setReviewOpen(false)}
        onChanged={() => { void refresh(); onChanged?.(); }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  headerText: { flex: 1, gap: 4 },
  title: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  muted: { color: textTokens.secondary, fontSize: 13, lineHeight: 19 },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: 120 },
  card: { backgroundColor: glass.tint.profileBase, borderColor: glass.border.profileBase, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: textTokens.primary, fontSize: 16, fontWeight: "700", flex: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stat: { color: textTokens.primary, fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  smallActions: { flexDirection: "row", gap: spacing.lg },
  actionText: { color: accent.warm, fontSize: 13, fontWeight: "700" },
  destructive: { color: semantic.error, fontSize: 13, fontWeight: "700" },
  pending: { marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: "rgba(250, 180, 40, 0.12)", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pendingText: { flex: 1, color: textTokens.primary, fontWeight: "600", fontSize: 13 },
  center: { alignItems: "center", paddingVertical: spacing.xl, gap: spacing.md },
  emptyTitle: { color: textTokens.primary, fontSize: 17, fontWeight: "700" },
  form: { padding: spacing.md, gap: spacing.md, paddingBottom: 120 },
  fieldLabel: { color: textTokens.primary, fontSize: 13, fontWeight: "700" },
  choices: { gap: spacing.sm },
  choicesRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  expiryChoice: { flex: 1 },
  expiryNative: { gap: spacing.sm },
  choiceActive: { borderColor: accent.warm, backgroundColor: "rgba(235,120,37,0.14)" },
  choiceText: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: glass.border.profileBase },
  helper: { color: textTokens.tertiary, fontSize: 12, lineHeight: 17 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  error: { color: semantic.error, fontSize: 13, lineHeight: 18 },
  createdCard: { gap: spacing.md },
  url: { color: textTokens.primary, fontFamily: "monospace", backgroundColor: glass.tint.profileBase, padding: spacing.md, borderRadius: radius.md },
  toast: { color: textTokens.primary, backgroundColor: "rgba(20,20,20,0.94)", padding: spacing.md, margin: spacing.md, borderRadius: radius.md, textAlign: "center" },
});

export default TicketLinksSheet;
