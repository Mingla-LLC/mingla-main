import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { captureWizardInvite } from "../../features/invites/wizardInviteAnalytics";
import { useOfferingInvitePlan } from "../../hooks/useOfferingInvitePlan";
import {
  createWizardInviteRequestId,
  formatWizardInviteMoney,
  WizardInvitePlanError,
  type WizardInvitePlan,
  type WizardInviteQuote,
  type WizardInviteSelection,
  type WizardOfferingType,
} from "../../services/offeringInvitePlanService";
import type { ManualGroupSummary } from "../../types/marketing";
import type { BrandPersonSummary } from "../../types/people";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Sheet } from "../ui/Sheet";

const OFFERING_LABEL: Record<WizardOfferingType, string> = {
  event: "event",
  rsvp: "RSVP",
  experience: "experience",
  trip: "trip",
};

export type InviteNavigationPhase = "checking" | "saving" | "error" | "ready";

export interface InviteNavigationState {
  phase: InviteNavigationPhase;
  primaryLabel: "Skip invites" | "Review" | "Checking…" | "Saving…" | "Try again";
  blocked: boolean;
  retry: () => void;
}

export interface InvitePeopleStepProps {
  eventId: string | null;
  brandId: string;
  eventType: WizardOfferingType;
  enabled?: boolean;
  onPlanChange?: (
    plan: WizardInvitePlan | null,
    quote: WizardInviteQuote | null,
    navigation: InviteNavigationState,
  ) => void;
}

type PendingReceipt = {
  key: string;
  id: string;
  selection: WizardInviteSelection;
  expectedRevision: number;
};

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();
const sameIds = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export function InvitePeopleStep({
  eventId,
  brandId,
  eventType,
  enabled = true,
  onPlanChange,
}: InvitePeopleStepProps) {
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [desiredIds, setDesiredIds] = useState<string[] | null>(null);
  const [dirtyDescription, setDirtyDescription] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const pendingReceipt = useRef<PendingReceipt | null>(null);
  const observedQuote = useRef<string | null>(null);
  const model = useOfferingInvitePlan({ eventId, brandId, search, enabled });
  const plan = model.plan.data ?? null;
  const quote = model.quote.data ?? null;
  const persistedIds = useMemo(
    () => sortedUnique(plan?.brandPersonIds ?? []),
    [plan?.brandPersonIds],
  );
  const visibleIds = desiredIds ?? persistedIds;
  const visibleSelected = useMemo(() => new Set(visibleIds), [visibleIds]);
  const people = useMemo(() => {
    const byId = new Map<string, BrandPersonSummary>();
    for (const page of model.people.data?.pages ?? []) {
      for (const person of page.rows) byId.set(person.personId, person);
    }
    return [...byId.values()];
  }, [model.people.data?.pages]);
  const bookCount = model.people.data?.pages[0]?.bookTotal ?? null;
  const isSaving = model.replace.isPending || model.clear.isPending;
  const quoteIsCurrent = Boolean(
    plan && quote && quote.selectionRevision === plan.selectionRevision &&
      quote.selectionHash === plan.selectionHash,
  );
  const isDirty = desiredIds !== null && !sameIds(visibleIds, persistedIds);
  const isChecking = model.plan.isPending || model.quote.isPending || model.quote.isFetching;
  const hasBlockingError = model.plan.isError || plan === null || model.quote.isError ||
    (plan !== null && !isChecking && !quoteIsCurrent) || isDirty ||
    dirtyDescription !== null || saveError !== null;

  const retry = () => {
    if (pendingReceipt.current !== null) {
      void persistSelection(
        pendingReceipt.current.selection,
        desiredIds,
        dirtyDescription,
        true,
      );
      return;
    }
    if (isDirty && desiredIds !== null) {
      void persistSelection(explicitSelection(desiredIds), desiredIds, dirtyDescription, false);
      return;
    }
    void model.refreshAuthoritative().catch(() => undefined);
  };

  const navigation: InviteNavigationState = isSaving
    ? { phase: "saving", primaryLabel: "Saving…", blocked: true, retry }
    : isChecking
      ? { phase: "checking", primaryLabel: "Checking…", blocked: true, retry }
      : hasBlockingError
        ? { phase: "error", primaryLabel: "Try again", blocked: false, retry }
        : {
          phase: "ready",
          primaryLabel: plan.selectedCount === 0 ? "Skip invites" : "Review",
          blocked: false,
          retry,
        };

  useEffect(() => {
    onPlanChange?.(plan, quoteIsCurrent ? quote : null, navigation);
  }, [
    ambiguous,
    desiredIds,
    dirtyDescription,
    navigation.blocked,
    navigation.phase,
    navigation.primaryLabel,
    onPlanChange,
    plan,
    quote,
    quoteIsCurrent,
    saveError,
  ]);

  useEffect(() => {
    if (!enabled || eventId === null) return;
    captureWizardInvite("wizard_invite_step_viewed", {
      offering_kind: eventType,
      selection_revision: plan?.selectionRevision,
      selected_count: plan?.selectedCount,
    });
  }, [brandId, enabled, eventId, eventType]);

  useEffect(() => {
    if (quoteIsCurrent && quote && observedQuote.current !== quote.quoteHash) {
      observedQuote.current = quote.quoteHash;
      captureWizardInvite("wizard_invite_quote_loaded", {
        offering_kind: eventType,
        selection_revision: quote.selectionRevision,
        selected_count: quote.selectedCount,
        can_receive: quote.canReceiveCount,
        skipped: quote.skippedCount,
        email_count: quote.perChannelReachable.email,
        text_count: quote.perChannelReachable.sms,
        mingla_count: quote.perChannelReachable.push,
        amount_minor: quote.estimatedCostMinor,
      });
    }
  }, [eventType, quote, quoteIsCurrent]);

  useEffect(() => {
    if (model.quote.isError) {
      captureWizardInvite("wizard_invite_quote_failed", {
        offering_kind: eventType,
        selection_revision: plan?.selectionRevision,
        error_code: "quote_unavailable",
      });
    }
  }, [eventType, model.quote.failureCount, model.quote.isError, plan?.selectionRevision]);

  function explicitSelection(ids: string[]): WizardInviteSelection {
    return {
      includeEveryone: false,
      manualGroupIds: [],
      personIds: sortedUnique(ids),
      excludedPersonIds: [],
    };
  }

  async function persistSelection(
    selection: WizardInviteSelection,
    localDesired: string[] | null,
    description: string | null,
    exactRetry: boolean,
  ): Promise<boolean> {
    if (!plan || isSaving || plan.state === "locked") return false;
    const normalized: WizardInviteSelection = {
      includeEveryone: selection.includeEveryone,
      manualGroupIds: sortedUnique(selection.manualGroupIds),
      personIds: sortedUnique(selection.personIds),
      excludedPersonIds: sortedUnique(selection.excludedPersonIds),
    };
    const key = JSON.stringify([plan.selectionRevision, normalized]);
    if (!exactRetry || pendingReceipt.current?.key !== key) {
      pendingReceipt.current = {
        key,
        id: createWizardInviteRequestId(),
        selection: normalized,
        expectedRevision: plan.selectionRevision,
      };
    }
    const receipt = pendingReceipt.current;
    if (receipt === null) return false;
    if (localDesired !== null) setDesiredIds(sortedUnique(localDesired));
    if (description !== null) setDirtyDescription(description);
    setSaveError(null);
    try {
      const next = await model.replace.mutateAsync({
        selection: receipt.selection,
        expectedRevision: receipt.expectedRevision,
        clientRequestId: receipt.id,
      });
      pendingReceipt.current = null;
      setAmbiguous(false);
      setDesiredIds(null);
      setDirtyDescription(null);
      captureWizardInvite("wizard_invite_plan_saved", {
        offering_kind: eventType,
        selection_revision: next.selectionRevision,
        selected_count: next.selectedCount,
      });
      return true;
    } catch (error) {
      const next = await model.refreshAuthoritative().catch(() => null);
      const authoritative = sortedUnique(next?.plan.brandPersonIds ?? []);
      const intended = localDesired === null ? null : sortedUnique(localDesired);
      if (next && intended !== null && sameIds(authoritative, intended)) {
        pendingReceipt.current = null;
        setAmbiguous(false);
        setDesiredIds(null);
        setDirtyDescription(null);
        setSaveError(null);
        return true;
      }
      const typed = error instanceof WizardInvitePlanError ? error : null;
      const definitive = typed !== null && !typed.retryable;
      if (typed?.code === "wizard_invite_revision_conflict") {
        pendingReceipt.current = null;
        setAmbiguous(false);
        captureWizardInvite("wizard_invite_plan_stale", {
          offering_kind: eventType,
          selection_revision: typed.currentRevision ?? undefined,
        });
      } else {
        setAmbiguous(!definitive);
      }
      setSaveError(
        typed?.code === "wizard_invite_selection_too_large"
          ? "You can invite up to 500 people. Remove someone before adding more."
          : "We couldn’t save that selection. It is still here and has not been discarded.",
      );
      captureWizardInvite("wizard_invite_plan_save_failed", {
        offering_kind: eventType,
        selection_revision: typed?.currentRevision ?? plan.selectionRevision,
        selected_count: intended?.length,
        error_code: typed?.code ?? "temporarily_unavailable",
      });
      return false;
    }
  }

  const openPicker = () => {
    setDesiredIds(persistedIds);
    setDirtyDescription(null);
    setSaveError(null);
    setAmbiguous(false);
    pendingReceipt.current = null;
    setPickerOpen(true);
  };
  const togglePerson = (personId: string) => {
    if (ambiguous) return;
    const next = new Set(visibleIds);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    setDesiredIds(sortedUnique([...next]));
    setDirtyDescription("Unsaved people selection");
    setSaveError(null);
  };
  const savePicker = async () => {
    if (ambiguous) {
      retry();
      return;
    }
    if (!isDirty) {
      setDesiredIds(null);
      setPickerOpen(false);
      return;
    }
    const saved = await persistSelection(
      explicitSelection(visibleIds),
      visibleIds,
      dirtyDescription,
      false,
    );
    if (saved) setPickerOpen(false);
  };

  if (!enabled) return null;
  if (eventId === null) {
    return <InviteStepState title="Save the basics first" description="Your invite selection attaches to the saved draft." />;
  }
  if (model.plan.isPending) {
    return <View style={styles.center}><ActivityIndicator color={accent.warm} /><Text style={styles.muted}>Loading your saved selection…</Text></View>;
  }
  if (model.plan.isError || plan === null) {
    return <InviteStepState title="We couldn’t load your invite list" description="Try again before continuing so your selection is not lost."
      actionLabel="Try again" onAction={() => void model.refreshAuthoritative()} />;
  }

  return (
    <View style={styles.root} testID={`invite-people-${eventType}`}>
      <Text style={styles.title}>Invite people</Text>
      <Text style={styles.subtitle}>
        Choose people from Your Book. Nothing sends until this {OFFERING_LABEL[eventType]} is published.
      </Text>
      <View style={styles.trustBanner} accessibilityRole="summary">
        <Text style={styles.trustTitle}>Nothing sends yet</Text>
        <Text style={styles.trustBody}>Your selections stay with this draft.</Text>
      </View>
      <InviteSourcePicker
        bookCount={bookCount}
        groups={model.groups.data ?? []}
        selectedCount={isDirty ? visibleIds.length : plan.selectedCount}
        disabled={isSaving || plan.state === "locked" || ambiguous}
        onSelectEveryone={() => void persistSelection(
          { includeEveryone: true, manualGroupIds: [], personIds: [], excludedPersonIds: [] },
          null,
          "Unsaved Everyone in Your Book selection",
          false,
        )}
        onSelectGroup={(groupId, groupName) => void persistSelection(
          { includeEveryone: false, manualGroupIds: [groupId], personIds: persistedIds, excludedPersonIds: [] },
          null,
          `Unsaved ${groupName} group selection`,
          false,
        )}
        onChoosePeople={openPicker}
      />
      <InviteSelectionSummary
        selectedCount={isDirty ? visibleIds.length : plan.selectedCount}
        people={people.filter((person) => visibleSelected.has(person.personId))}
        saving={isSaving}
        dirty={isDirty || dirtyDescription !== null}
        onClear={() => void persistSelection(explicitSelection([]), [], "Unsaved cleared selection", false)}
      />
      {dirtyDescription ? <Text accessibilityRole="alert" style={styles.dirty}>{dirtyDescription}</Text> : null}
      <InviteQuoteCard quote={quoteIsCurrent ? quote : null} loading={isChecking} error={model.quote.isError} />
      {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
      <PeoplePickerSheet
        visible={pickerOpen}
        onClose={() => { if (!isSaving) setPickerOpen(false); }}
        search={search}
        onSearch={setSearch}
        people={people}
        selected={visibleSelected}
        bookCount={bookCount}
        filteredCount={model.people.data?.pages[0]?.filteredTotal ?? null}
        pending={model.people.isPending}
        error={model.people.isError}
        loadingMore={model.people.isFetchingNextPage}
        hasMore={model.people.hasNextPage}
        disabled={isSaving || plan.state === "locked" || ambiguous}
        onLoadMore={() => void model.people.fetchNextPage()}
        onToggle={togglePerson}
        onDone={() => void savePicker()}
        selectedCount={visibleIds.length}
        saving={isSaving}
        errorMessage={saveError}
      />
    </View>
  );
}

export function InviteSourcePicker(props: {
  bookCount: number | null;
  groups: ManualGroupSummary[];
  selectedCount: number;
  disabled: boolean;
  onSelectEveryone: () => void;
  onSelectGroup: (groupId: string, groupName: string) => void;
  onChoosePeople: () => void;
}) {
  return (
    <View style={styles.sourceCard}>
      <SourceRow title="Everyone in Your Book" detail={props.bookCount === null ? "Checking count…" : `${props.bookCount} active people`}
        action="Select all" disabled={props.disabled} onPress={props.onSelectEveryone} />
      <View style={styles.divider} />
      <Text style={styles.sourceTitle}>Saved groups</Text>
      {props.groups.length === 0 ? <Text style={styles.muted}>No saved manual groups yet.</Text> :
        props.groups.map((group) => <SourceRow key={group.groupId} title={group.name}
          detail={`${group.memberCount} people`} action="Add group" disabled={props.disabled}
          onPress={() => props.onSelectGroup(group.groupId, group.name)} />)}
      <View style={styles.divider} />
      <SourceRow title="Choose people" detail={`${props.selectedCount} selected`}
        action={props.selectedCount === 0 ? "Choose people" : "Edit selection"}
        disabled={props.disabled} onPress={props.onChoosePeople} />
    </View>
  );
}

function SourceRow(props: { title: string; detail: string; action: string; disabled: boolean; onPress: () => void }) {
  return <View style={styles.sourceRow}><View style={styles.flex}><Text style={styles.sourceTitle}>{props.title}</Text>
    <Text style={styles.muted}>{props.detail}</Text></View><Button label={props.action} size="sm" variant="secondary"
      disabled={props.disabled} onPress={props.onPress} /></View>;
}

function PeoplePickerSheet(props: {
  visible: boolean;
  onClose: () => void;
  search: string;
  onSearch: (value: string) => void;
  people: BrandPersonSummary[];
  selected: Set<string>;
  bookCount: number | null;
  filteredCount: number | null;
  pending: boolean;
  error: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  disabled: boolean;
  onLoadMore: () => void;
  onToggle: (personId: string) => void;
  onDone: () => void;
  selectedCount: number;
  saving: boolean;
  errorMessage: string | null;
}) {
  const noBook = props.bookCount === 0;
  const noMatch = !noBook && props.search.trim().length > 0 && props.filteredCount === 0;
  return (
    <Sheet visible={props.visible} onClose={props.onClose} snapPoint="full" testID="wizard-invite-people-sheet">
      <View style={styles.sheetRoot}>
        <View style={styles.sheetHeader}>
          <Text style={styles.title}>Choose people</Text>
          <Text style={styles.muted}>Select active people from Your Book.</Text>
          <TextInput
            value={props.search}
            onChangeText={props.onSearch}
            placeholder="Search by name, email, or phone"
            placeholderTextColor={textTokens.tertiary}
            accessibilityLabel="Search by name, email, or phone"
            style={styles.search}
          />
        </View>
        <ScrollView style={styles.peopleScroll} contentContainerStyle={styles.peopleContent} keyboardShouldPersistTaps="handled">
          {props.pending ? <ActivityIndicator color={accent.warm} /> :
            props.error ? <Text style={styles.error}>People are unavailable. Try again.</Text> :
              noBook ? <Text style={styles.muted}>Your Book is empty. Add people before choosing invitations.</Text> :
                noMatch ? <Text style={styles.muted}>No people match this search.</Text> :
                  props.people.map((person) => (
                    <PersonRow key={person.personId} person={person} selected={props.selected.has(person.personId)}
                      disabled={props.disabled} onPress={() => props.onToggle(person.personId)} />
                  ))}
          {props.hasMore ? <Button label={props.loadingMore ? "Loading…" : "Load more"} variant="secondary"
            disabled={props.loadingMore} onPress={props.onLoadMore} /> : null}
        </ScrollView>
        <View style={styles.sheetFooter}>
          {props.errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{props.errorMessage}</Text> : null}
          <Button label={`Done · ${props.selectedCount} selected`} loading={props.saving}
            disabled={props.saving} onPress={props.onDone} />
        </View>
      </View>
    </Sheet>
  );
}

function PersonRow(props: { person: BrandPersonSummary; selected: boolean; disabled: boolean; onPress: () => void }) {
  const contact = props.person.contacts.find((item) => item.isPrimary) ?? props.person.contacts[0];
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: props.selected, disabled: props.disabled }}
    disabled={props.disabled} onPress={props.onPress} style={[styles.personRow, props.selected && styles.personSelected]}>
    <View style={[styles.avatar, props.selected && styles.avatarSelected]}><Text style={styles.avatarText}>
      {props.person.displayName.trim().slice(0, 1).toUpperCase()}</Text></View>
    <View style={styles.flex}><Text style={styles.personName}>{props.person.displayName}</Text>
      <Text numberOfLines={1} style={styles.muted}>{contact?.value ?? "Mingla account"}</Text></View>
    <Text style={[styles.check, props.selected && styles.checkSelected]}>{props.selected ? "✓" : "+"}</Text>
  </Pressable>;
}

export function InviteSelectionSummary(props: {
  selectedCount: number;
  people: BrandPersonSummary[];
  saving: boolean;
  dirty: boolean;
  onClear: () => void;
}) {
  return <View style={styles.summaryCard}><View style={styles.flex}><Text style={styles.sectionTitle}>
    {props.selectedCount === 0 ? "No one selected" : `${props.selectedCount} selected`}</Text>
    <View style={styles.avatarStack}>{props.people.slice(0, 5).map((person) => <View key={person.personId} style={styles.smallAvatar}>
      <Text style={styles.smallAvatarText}>{person.displayName.slice(0, 1).toUpperCase()}</Text></View>)}</View>
    {props.dirty ? <Text style={styles.dirty}>Unsaved</Text> : null}</View>
    {props.selectedCount > 0 ? <Button label={props.saving ? "Saving…" : "Clear all"} size="sm" variant="ghost"
      disabled={props.saving} onPress={props.onClear} /> : null}</View>;
}

export function InviteQuoteCard(props: { quote: WizardInviteQuote | null; loading: boolean; error: boolean }) {
  if (props.loading) return <View style={styles.quoteCard}><Text style={styles.sectionTitle}>Invite delivery</Text><Text style={styles.muted}>Checking…</Text></View>;
  if (props.error || props.quote === null) return <View style={styles.quoteCard}><Text style={styles.sectionTitle}>Invite delivery</Text>
    <Text style={styles.error}>Delivery estimate unavailable. Refresh before publishing.</Text></View>;
  const q = props.quote;
  return <View style={styles.quoteCard}><Text style={styles.sectionTitle}>Invite delivery</Text>
    <View style={styles.metricRow}><Metric label="Selected" value={q.selectedCount} /><Metric label="Can receive" value={q.canReceiveCount} />
      <Metric label="Skipped" value={q.skippedCount} /></View>
    {q.selectedCount > 0 && q.canReceiveCount === 0 ? <Text style={styles.zeroReachable}>
      No selected people can receive an invite right now. You can still publish without sending invitations.
    </Text> : null}
    <Text style={styles.channelText}>Email {q.perChannelReachable.email} · Text {q.perChannelReachable.sms} · Mingla {q.perChannelReachable.push}</Text>
    <Text style={styles.cost}>{q.estimatedCostMinor > 0 ? `Estimated text cost ${formatWizardInviteMoney(q.estimatedCostMinor, q.currency)}` : "No paid-channel cost"}</Text>
  </View>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.muted}>{label}</Text></View>;
}

export function InvitePlanReviewSummary(props: { plan: WizardInvitePlan | null; quote: WizardInviteQuote | null }) {
  if (!props.plan || props.plan.selectedCount === 0) return <View style={styles.reviewSummary}><Text style={styles.sectionTitle}>Invites</Text><Text style={styles.muted}>No invitations planned.</Text></View>;
  return <View style={styles.reviewSummary}><Text style={styles.sectionTitle}>Invites</Text>
    <Text style={styles.personName}>{props.quote ? `${props.quote.canReceiveCount} can receive` : "Checking delivery…"}</Text>
    <Text style={styles.muted}>{props.quote ? `${props.quote.skippedCount} skipped · ${props.plan.selectedCount} selected` : "Publish is unavailable until the latest estimate loads."}</Text>
    {props.quote?.canReceiveCount === 0 ? <Text style={styles.zeroReachable}>
      No selected people can receive an invite right now. Publish without invitations if you want the offering to go live.
    </Text> : null}</View>;
}

export function InvitePeoplePublishConfirmation(props: {
  visible: boolean;
  eventType: WizardOfferingType;
  plan: WizardInvitePlan | null;
  quote: WizardInviteQuote | null;
  publishing: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const selected = props.plan?.selectedCount ?? 0;
  const canReceive = props.quote?.canReceiveCount ?? 0;
  const skipped = props.quote?.skippedCount ?? 0;
  const confirmationKey = props.visible && props.plan && props.quote
    ? `${props.plan.selectionRevision}:${props.quote.quoteHash}:${canReceive}:${skipped}` : null;
  const openedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!props.visible) {
      openedKey.current = null;
      return;
    }
    if (confirmationKey === null) return;
    if (openedKey.current === null) openedKey.current = confirmationKey;
    else if (openedKey.current !== confirmationKey) props.onClose();
  }, [confirmationKey, props.onClose, props.visible]);
  const estimate = props.quote && props.quote.estimatedCostMinor > 0
    ? ` Estimated text cost: ${formatWizardInviteMoney(props.quote.estimatedCostMinor, props.quote.currency)}.` : "";
  const zeroReachable = selected > 0 && canReceive === 0;
  const description = zeroReachable
    ? `This ${OFFERING_LABEL[props.eventType]} and its link go live first. No selected people can receive an invite right now, so no invitations will be sent.${estimate}`
    : `This ${OFFERING_LABEL[props.eventType]} and its link go live first. ${canReceive} ${canReceive === 1 ? "invite is" : "invites are"} queued only after publication succeeds; ${skipped} selected ${skipped === 1 ? "person is" : "people are"} skipped.${estimate}`;
  return <ConfirmDialog visible={props.visible} onClose={props.onClose} onConfirm={() => {
    captureWizardInvite("wizard_invite_publish_confirmed", {
      offering_kind: props.eventType,
      selection_revision: props.plan?.selectionRevision,
      selected_count: selected,
      can_receive: canReceive,
      skipped,
      amount_minor: props.quote?.estimatedCostMinor,
    });
    return props.onConfirm();
  }}
    title={`Publish ${OFFERING_LABEL[props.eventType]} and send ${canReceive} ${canReceive === 1 ? "invite" : "invites"}?`}
    description={description}
    confirmLabel={zeroReachable ? "Publish without invites" : `Publish & invite ${canReceive}`}
    cancelLabel="Keep reviewing" confirmLoading={props.publishing}
    confirmDisabled={selected > 0 && props.quote === null} closeDisabled={props.publishing}
    errorMessage={props.errorMessage ?? null} testID={`publish-${props.eventType}-with-invites`} />;
}

function InviteStepState(props: { title: string; description: string; actionLabel?: string; onAction?: () => void }) {
  return <View style={styles.center}><Text style={styles.title}>{props.title}</Text><Text style={styles.muted}>{props.description}</Text>
    {props.actionLabel && props.onAction ? <Button label={props.actionLabel} onPress={props.onAction} variant="secondary" /> : null}</View>;
}

const styles = StyleSheet.create({
  root: { gap: spacing.md, width: "100%" },
  center: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  title: { ...typography.h2, color: textTokens.primary },
  subtitle: { ...typography.body, color: textTokens.secondary },
  trustBanner: { borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(34,197,94,0.35)", backgroundColor: "rgba(34,197,94,0.10)", padding: spacing.md },
  trustTitle: { ...typography.body, color: semantic.success, fontWeight: "700" },
  trustBody: { ...typography.bodySm, color: textTokens.secondary },
  sourceCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase, padding: spacing.md, gap: spacing.sm },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 64 },
  sourceTitle: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileBase },
  summaryCard: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, backgroundColor: glass.tint.profileElevated, padding: spacing.md, gap: spacing.sm },
  avatarStack: { flexDirection: "row", marginTop: spacing.xxs },
  smallAvatar: { width: 24, height: 24, marginRight: -6, borderRadius: 12, backgroundColor: accent.warm, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#171717" },
  smallAvatarText: { ...typography.caption, color: textTokens.inverse, fontWeight: "700" },
  sectionTitle: { ...typography.h3, color: textTokens.primary },
  search: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase, color: textTokens.primary, paddingHorizontal: spacing.md, ...typography.body },
  personRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md },
  personSelected: { backgroundColor: "rgba(235,120,37,0.12)" },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: glass.tint.profileElevated, alignItems: "center", justifyContent: "center" },
  avatarSelected: { backgroundColor: accent.warm },
  avatarText: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  personName: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  check: { ...typography.h3, color: textTokens.tertiary },
  checkSelected: { color: accent.warm },
  quoteCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase, padding: spacing.md, gap: spacing.sm },
  metricRow: { flexDirection: "row", gap: spacing.lg },
  metric: { flex: 1 },
  metricValue: { ...typography.h3, color: textTokens.primary },
  channelText: { ...typography.bodySm, color: textTokens.secondary },
  cost: { ...typography.bodySm, color: accent.warm, fontWeight: "600" },
  reviewSummary: { borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase, padding: spacing.md, gap: spacing.xxs },
  sheetRoot: { flex: 1, minHeight: 0 },
  sheetHeader: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  peopleScroll: { flex: 1, minHeight: 0 },
  peopleContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xxs },
  sheetFooter: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase, padding: spacing.lg, gap: spacing.sm },
  zeroReachable: { ...typography.bodySm, color: textTokens.primary },
  dirty: { ...typography.bodySm, color: accent.warm, fontWeight: "600" },
  muted: { ...typography.bodySm, color: textTokens.secondary },
  error: { ...typography.bodySm, color: semantic.error },
  flex: { flex: 1 },
});
