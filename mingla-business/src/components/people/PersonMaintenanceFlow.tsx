import React from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  accent,
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { PeopleServiceError } from "../../services/peopleService";
import type {
  BrandPersonIdentitySummary,
  BrandPersonMaintenanceOperation,
  BrandPersonMergeCandidate,
  BrandPersonMergePreview,
  BrandPersonMergeResult,
  BrandPersonSplitPreview,
  BrandPersonSplitResult,
} from "../../types/people";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import { Skeleton } from "../ui/Skeleton";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { IdentityOperationReceipt } from "./IdentityOperationReceipt";
import { PersonComparisonCard } from "./PersonComparisonCard";

type FlowError = Error | null;

export interface PersonMaintenanceFlowProps {
  person: BrandPersonIdentitySummary;
  online: boolean;
  mergeVisible: boolean;
  candidateSearch: string;
  onCandidateSearchChange: (value: string) => void;
  candidateRows: BrandPersonMergeCandidate[];
  candidatesLoading: boolean;
  candidatesLoadingMore: boolean;
  candidatesError: FlowError;
  hasNextCandidates: boolean;
  onLoadMoreCandidates: () => void;
  onRetryCandidates: () => void;
  preview: BrandPersonMergePreview | undefined;
  previewLoading: boolean;
  previewError: FlowError;
  onRetryPreview: () => void;
  onSelectedPersonIdChange: (personId: string | null) => void;
  onMergeReviewOpenChange: (open: boolean) => void;
  onMerge: (input: {
    intentKey: string;
    winnerPersonId: string;
    loserPersonId: string;
    winnerVersion: string;
    loserVersion: string;
  }) => Promise<BrandPersonMergeResult>;
  mergePending: boolean;
  onCloseMerge: () => void;
  onOpenReview: () => void;
  onViewMergedPerson: (personId: string) => void;
  splitVisible: boolean;
  splitPreview: BrandPersonSplitPreview | undefined;
  splitLoading: boolean;
  splitError: FlowError;
  onRetrySplitPreview: () => void;
  splitMergeEventId: string | null;
  onSplit: (input: {
    intentKey: string;
    mergeEventId: string;
    splitVersion: string;
  }) => Promise<BrandPersonSplitResult>;
  splitPending: boolean;
  onCloseSplit: () => void;
  onViewPeople: () => void;
  onEmailSupport: (supportReference: string) => void;
  restoredOperation?: BrandPersonMaintenanceOperation | null;
  restoredOperationKind?: "merge" | "promote" | "split" | null;
  onAcknowledgeReceipt?: () => void | Promise<void>;
  onCheckRecovery?: () => void;
  onStaleReview?: (message: string) => void;
}

type FocusTarget = React.ElementRef<typeof Text> & { focus?: () => void };

function focusAfterLayout(target: React.RefObject<FocusTarget | null>): void {
  const focus = (): void => {
    if (Platform.OS === "web") {
      target.current?.focus?.();
      return;
    }
    const handle = findNodeHandle(target.current);
    if (handle !== null) AccessibilityInfo?.setAccessibilityFocus?.(handle);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
  else setTimeout(focus, 0);
}

function announce(message: string): void {
  AccessibilityInfo?.announceForAccessibility?.(message);
}

const Header = React.forwardRef<FocusTarget, {
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeDisabled: boolean;
  stacked: boolean;
}>(function Header({
  title,
  subtitle,
  onClose,
  closeDisabled,
  stacked,
}, ref) {
  return (
    <View style={[styles.header, stacked ? styles.stacked : null]}>
      <View style={styles.headerCopy}>
        <Text ref={ref} accessible accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <Button
        label="Close"
        accessibilityLabel="Close"
        variant="ghost"
        size="md"
        disabled={closeDisabled}
        onPress={onClose}
      />
    </View>
  );
});

function CurrentPersonCard({
  person,
  stacked,
}: {
  person: BrandPersonIdentitySummary;
  stacked: boolean;
}) {
  const email = person.contacts.find((contact) =>
    contact.channel === "email" && contact.isPrimary
  );
  const phone = person.contacts.find((contact) =>
    contact.channel === "phone" && contact.isPrimary
  );
  return (
    <View style={[styles.currentCard, stacked ? styles.largeTextRow : null]}>
      <Avatar name={person.displayName} photo={person.avatarUrl ?? undefined} size="row" />
      <View style={styles.currentCopy}>
        <Text style={styles.currentLabel}>Current person</Text>
        <Text style={styles.currentName}>{person.displayName}</Text>
        {email ? <Text style={styles.currentContact}>Primary email: {email.value}</Text> : null}
        {phone ? <Text style={styles.currentContact}>Primary phone: {phone.value}</Text> : null}
      </View>
    </View>
  );
}

function CandidateRow({
  person,
  disabled,
  stacked,
  onPress,
}: {
  person: BrandPersonMergeCandidate;
  disabled: boolean;
  stacked: boolean;
  onPress: () => void;
}) {
  const primaryEmail = person.contacts.find((contact) =>
    contact.channel === "email" && contact.isPrimary
  );
  const primaryPhone = person.contacts.find((contact) =>
    contact.channel === "phone" && contact.isPrimary
  );
  const matching = person.matchedContact;
  const alternateMatch = matching !== null && matching.id !==
    (matching.channel === "email" ? primaryEmail?.id : primaryPhone?.id);
  const matchedAlternate = alternateMatch ? matching : null;
  const facts = [
    primaryEmail ? `primary email ${primaryEmail.value}` : null,
    primaryPhone ? `primary phone ${primaryPhone.value}` : null,
    matchedAlternate
      ? `matched ${matchedAlternate.channel} ${matchedAlternate.value}`
      : null,
  ].filter((value): value is string => value !== null);
  return (
    <Pressable
      accessibilityLabel={[person.displayName, ...facts].join(", ")}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={`merge-candidate-${person.personId}`}
      style={({ pressed }) => [
        styles.candidateRow,
        stacked ? styles.largeTextRow : null,
        pressed && !disabled && styles.candidatePressed,
      ]}
    >
      <Avatar name={person.displayName} photo={person.avatarUrl ?? undefined} size="row" />
      <View style={styles.candidateCopy}>
        <Text style={styles.candidateName}>{person.displayName}</Text>
        {primaryEmail ? (
          <Text style={styles.candidateContact}>Primary email: {primaryEmail.value}</Text>
        ) : null}
        {primaryPhone ? (
          <Text style={styles.candidateContact}>Primary phone: {primaryPhone.value}</Text>
        ) : null}
        {matchedAlternate ? (
          <Text style={styles.matchedContact}>
            Matched {matchedAlternate.channel}: {matchedAlternate.value}
          </Text>
        ) : null}
      </View>
      <Icon name="chevR" size={20} color={text.secondary} />
    </Pressable>
  );
}

function errorCode(error: FlowError): string | null {
  return error instanceof PeopleServiceError ? error.code : error ? "people_unknown" : null;
}

function mergedResultFacts(
  preview: BrandPersonMergePreview,
  survivorId: string,
): { name: string; email: string | null; phone: string | null; aliases: string[] } {
  const winner = survivorId === preview.left.personId ? preview.left : preview.right;
  const loser = survivorId === preview.left.personId ? preview.right : preview.left;
  const primary = (channel: "email" | "phone"): string | null => (
    winner.contacts.find((contact) => contact.channel === channel && contact.isPrimary)
      ?? winner.contacts.find((contact) => contact.channel === channel)
      ?? loser.contacts.find((contact) => contact.channel === channel && contact.isPrimary)
      ?? loser.contacts.find((contact) => contact.channel === channel)
  )?.value ?? null;
  const normalizedWinner = winner.displayName.trim().toLocaleLowerCase();
  const aliases = Array.from(new Set([
    ...winner.alternateNames,
    loser.displayName,
    ...loser.alternateNames,
  ].map((value) => value.trim()).filter((value) => (
    value.length > 0 && value.toLocaleLowerCase() !== normalizedWinner
  ))));
  return {
    name: winner.displayName,
    email: primary("email"),
    phone: primary("phone"),
    aliases,
  };
}

function mergeBlock(preview: BrandPersonMergePreview): React.ReactElement | null {
  if (preview.state === "open_conflict") {
    return (
      <View accessibilityRole="alert" style={styles.warning}>
        <Icon name="shield" size={20} color={semantic.warning} />
        <View style={styles.blockCopy}>
          <Text style={styles.warningTitle}>Review needed first</Text>
          <Text style={styles.blockText}>Resolve the open contact review before merging these people.</Text>
        </View>
      </View>
    );
  }
  if (preview.state === "distinct_linked_users") {
    return (
      <View accessibilityRole="alert" style={styles.errorBlock}>
        <Icon name="link" size={20} color={semantic.error} />
        <Text style={styles.blockText}>
          These records are linked to different Mingla accounts and can’t be merged.
        </Text>
      </View>
    );
  }
  return null;
}

export function PersonMaintenanceFlow(
  props: PersonMaintenanceFlowProps,
): React.ReactElement {
  const { width, fontScale } = useWindowDimensions();
  const [mergeStep, setMergeStep] = React.useState<"picker" | "review" | "receipt">("picker");
  const [survivorId, setSurvivorId] = React.useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = React.useState(false);
  const [mergeError, setMergeError] = React.useState<string | null>(null);
  const [mergeResult, setMergeResult] = React.useState<BrandPersonMergeResult | null>(null);
  const [confirmSplit, setConfirmSplit] = React.useState(false);
  const [splitResult, setSplitResult] = React.useState<BrandPersonSplitResult | null>(null);
  const [splitMutationError, setSplitMutationError] = React.useState<string | null>(null);
  const pickerHeadingRef = React.useRef<FocusTarget | null>(null);
  const reviewHeadingRef = React.useRef<FocusTarget | null>(null);
  const mergeAlertRef = React.useRef<FocusTarget | null>(null);
  const splitHeadingRef = React.useRef<FocusTarget | null>(null);
  const splitAlertRef = React.useRef<FocusTarget | null>(null);
  const mergeConfirmHeadingRef = React.useRef<FocusTarget | null>(null);
  const splitConfirmHeadingRef = React.useRef<FocusTarget | null>(null);
  const mergeConfirmTriggerRef = React.useRef<React.ElementRef<typeof Pressable> | null>(null);
  const splitConfirmTriggerRef = React.useRef<React.ElementRef<typeof Pressable> | null>(null);
  const stacked = width < 352 || fontScale >= 2;

  React.useEffect(() => {
    if (props.mergeVisible) return;
    setMergeStep("picker");
    setSurvivorId(null);
    setConfirmMerge(false);
    setMergeError(null);
    setMergeResult(null);
    props.onSelectedPersonIdChange(null);
    props.onMergeReviewOpenChange(false);
  }, [
    props.mergeVisible,
    props.onMergeReviewOpenChange,
    props.onSelectedPersonIdChange,
  ]);

  React.useEffect(() => {
    if (props.splitVisible) return;
    setConfirmSplit(false);
    setSplitResult(null);
    setSplitMutationError(null);
  }, [props.splitVisible]);

  React.useEffect(() => {
    if (!props.mergeVisible) return;
    if (confirmMerge && stacked) focusAfterLayout(mergeConfirmHeadingRef);
    else if (mergeError || props.previewError) focusAfterLayout(mergeAlertRef);
    else focusAfterLayout(mergeStep === "picker" ? pickerHeadingRef : reviewHeadingRef);
  }, [confirmMerge, mergeError, mergeStep, props.mergeVisible, props.previewError, stacked]);

  React.useEffect(() => {
    if (!props.splitVisible) return;
    if (confirmSplit && stacked) focusAfterLayout(splitConfirmHeadingRef);
    else if (splitMutationError || props.splitError) focusAfterLayout(splitAlertRef);
    else focusAfterLayout(splitHeadingRef);
  }, [confirmSplit, props.splitError, props.splitVisible, splitMutationError, stacked]);

  React.useEffect(() => {
    const operation = props.restoredOperation;
    if (props.restoredOperationKind === "merge" && operation &&
      "survivorPersonId" in operation) {
      setMergeResult(operation);
      setMergeStep("receipt");
    }
    if (props.restoredOperationKind === "split" && operation && "outcome" in operation &&
      (operation.outcome === "reversed" || operation.outcome === "escalated")) {
      setSplitResult(operation);
    }
  }, [props.restoredOperation, props.restoredOperationKind]);

  const chooseCandidate = (candidate: BrandPersonMergeCandidate): void => {
    setSurvivorId(null);
    setMergeStep("review");
    props.onSelectedPersonIdChange(candidate.personId);
    props.onMergeReviewOpenChange(true);
  };

  const closeMerge = (): void => {
    if (props.mergePending) return;
    if (confirmMerge) {
      setConfirmMerge(false);
      return;
    }
    if (mergeStep === "review") {
      setMergeStep("picker");
      setSurvivorId(null);
      props.onSelectedPersonIdChange(null);
      props.onMergeReviewOpenChange(false);
      return;
    }
    props.onCloseMerge();
  };

  const submitMerge = async (): Promise<void> => {
    const preview = props.preview;
    if (!preview || preview.state !== "ready" || survivorId === null) return;
    const winner = survivorId === preview.left.personId ? preview.left : preview.right;
    const loser = survivorId === preview.left.personId ? preview.right : preview.left;
    const winnerVersion = winner.personId === preview.left.personId
      ? preview.leftVersion
      : preview.rightVersion;
    const loserVersion = loser.personId === preview.left.personId
      ? preview.leftVersion
      : preview.rightVersion;
    setMergeError(null);
    announce("Merging people…");
    try {
      const result = await props.onMerge({
        intentKey: `${winner.personId}:${loser.personId}:${winnerVersion}:${loserVersion}`,
        winnerPersonId: winner.personId,
        loserPersonId: loser.personId,
        winnerVersion,
        loserVersion,
      });
      if (
        result.survivorPersonId !== preview.left.personId &&
        result.survivorPersonId !== preview.right.personId
      ) {
        throw new PeopleServiceError("people_unknown", false);
      }
      setConfirmMerge(false);
      setSurvivorId(result.survivorPersonId);
      setMergeResult(result);
      setMergeStep("receipt");
    } catch (caught) {
      const code = errorCode(caught instanceof Error ? caught : new Error("unknown"));
      if (code === "people_merge_stale") {
        setConfirmMerge(false);
        setSurvivorId(null);
        setMergeStep("picker");
        props.onSelectedPersonIdChange(null);
        props.onMergeReviewOpenChange(false);
        const message = "This record changed. Review the latest details before trying again.";
        setMergeError(message);
        props.onStaleReview?.(message);
        void props.onRetryCandidates();
      } else if (code === "people_forbidden") {
        setMergeError("You don’t have permission to do that.");
      } else if (!props.online) {
        setMergeError("You’re offline. Reconnect to continue. Nothing has changed.");
      } else {
        setMergeError("Mingla couldn’t confirm the merge.");
      }
    }
  };

  const submitSplit = async (): Promise<void> => {
    if (!props.splitMergeEventId || props.splitPreview?.state !== "safe") return;
    setSplitMutationError(null);
    announce("Splitting merge…");
    try {
      const result = await props.onSplit({
        intentKey: `${props.splitMergeEventId}:${props.splitPreview.splitVersion}`,
        mergeEventId: props.splitMergeEventId,
        splitVersion: props.splitPreview.splitVersion,
      });
      setConfirmSplit(false);
      setSplitResult(result);
    } catch (caught) {
      const code = errorCode(caught instanceof Error ? caught : new Error("unknown"));
      if (code === "people_split_stale") {
        setConfirmSplit(false);
        const message = "This record changed. Review the latest details before trying again.";
        setSplitMutationError(message);
        props.onStaleReview?.(message);
        props.onCloseSplit();
        return;
      }
      setSplitMutationError(code === "people_forbidden"
        ? "You don’t have permission to do that."
        : !props.online
        ? "You’re offline. Reconnect to continue. Nothing has changed."
        : "Mingla couldn’t confirm the Split. Nothing has changed.");
    }
  };

  const mergeReceiptPerson = mergeResult && props.preview?.state === "ready"
    ? [props.preview.left, props.preview.right].find((candidate) =>
      candidate.personId === mergeResult.survivorPersonId
    ) ?? null
    : mergeResult?.survivorPersonId === props.person.personId
    ? props.person
    : null;
  const mergeReceiptName = mergeReceiptPerson?.displayName ?? null;
  const splitUnsafeReference = props.splitPreview?.state === "unsafe"
    ? props.splitPreview.supportReference
    : null;
  const resultFacts = props.preview?.state === "ready" && survivorId
    ? mergedResultFacts(props.preview, survivorId)
    : null;
  const survivorName = survivorId === props.preview?.left.personId
    ? props.preview.left.displayName
    : props.preview?.right.displayName ?? "this person";
  const absorbedName = survivorId === props.preview?.left.personId
    ? props.preview?.right.displayName
    : props.preview?.left.displayName ?? "The other record";
  const mergeConfirmationDescription = `${absorbedName} will become part of ${survivorName}. Every email and phone stays available. Past orders, tickets, RSVPs, bookings, payments, and sends do not change.`;

  return (
    <>
      <Sheet
        visible={props.mergeVisible}
        onClose={closeMerge}
        snapPoint="full"
        dismissOnScrimTap={!props.mergePending}
      >
        {mergeStep === "receipt" && mergeResult && mergeReceiptName ? (
          <IdentityOperationReceipt
            kind="merge"
            survivorName={mergeReceiptName}
            onPrimary={() => {
              props.onViewMergedPerson(mergeResult.survivorPersonId);
              void props.onAcknowledgeReceipt?.();
            }}
          />
        ) : mergeStep === "receipt" && mergeResult ? (
          <View style={styles.receiptError}>
            <Text ref={mergeAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
              Mingla couldn’t safely match the completed merge to these people.
            </Text>
            <Button label="Check again" onPress={() => props.onCheckRecovery?.()} />
          </View>
        ) : mergeStep === "picker" ? (
          <View style={styles.sheetBody}>
            <Header
              ref={pickerHeadingRef}
              title="Merge a duplicate"
              subtitle="Choose the other record. Nothing changes until you review and confirm."
              onClose={closeMerge}
              closeDisabled={props.mergePending}
              stacked={stacked}
            />
            <CurrentPersonCard person={props.person} stacked={stacked} />
            {mergeError ? (
              <Text ref={mergeAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
                {mergeError}
              </Text>
            ) : null}
            <Input
              value={props.candidateSearch}
              onChangeText={props.onCandidateSearchChange}
              variant="search"
              placeholder="Search name, email or phone"
              accessibilityLabel="Search name, email or phone"
              clearable
              disabled={props.candidatesLoading || !props.online}
            />
            {!props.online ? (
              <View accessibilityRole="alert" style={styles.warning}>
                <View style={styles.blockCopy}>
                  <Text style={styles.warningTitle}>You’re offline</Text>
                  <Text style={styles.blockText}>Reconnect to continue. Nothing has changed.</Text>
                </View>
              </View>
            ) : null}
            {props.candidatesLoading && props.candidateRows.length === 0 ? (
              <View accessibilityLiveRegion="polite" style={styles.skeletons}>
                {[0, 1, 2].map((key) => <Skeleton key={key} width="100%" height={72} />)}
              </View>
            ) : props.candidatesError && props.candidateRows.length === 0 ? (
              <View accessibilityRole="alert" style={styles.empty}>
                <Text style={styles.emptyTitle}>People couldn’t be loaded.</Text>
                <Button label="Try again" variant="secondary" onPress={props.onRetryCandidates} />
              </View>
            ) : props.candidateRows.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  {props.candidateSearch.trim() ? "No other people found" : "No other people to merge"}
                </Text>
                <Text style={styles.subtitle}>
                  {props.candidateSearch.trim()
                    ? "Try another name, email, or phone."
                    : "When another active person is in your book, you can choose them here."}
                </Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
                {props.candidateRows.map((candidate) => (
                  <CandidateRow
                    key={candidate.personId}
                    person={candidate}
                    disabled={!props.online}
                    stacked={stacked}
                    onPress={() => chooseCandidate(candidate)}
                  />
                ))}
                {props.candidatesError ? (
                  <View accessibilityRole="alert" style={styles.paginationError}>
                    <Text style={styles.blockText}>More people couldn’t be loaded.</Text>
                    <Button label="Try again" variant="ghost" onPress={props.onRetryCandidates} />
                  </View>
                ) : null}
                {props.hasNextCandidates ? (
                  <Button
                    label={props.candidatesLoadingMore ? "Loading more" : "Load more"}
                    variant="ghost"
                    loading={props.candidatesLoadingMore}
                    onPress={props.onLoadMoreCandidates}
                  />
                ) : null}
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <Header
              ref={reviewHeadingRef}
              title="Review these two people"
              subtitle="Choose the person you want to keep."
              onClose={closeMerge}
              closeDisabled={props.mergePending}
              stacked={stacked}
            />
            {props.previewLoading ? (
              <View accessibilityLiveRegion="polite" style={[styles.comparisonRow, stacked && styles.stacked]}>
                <Skeleton width={stacked ? "100%" : "48%"} height={240} />
                <Skeleton width={stacked ? "100%" : "48%"} height={240} />
              </View>
            ) : props.previewError ? (
              <View style={styles.blockStack}>
                <View accessibilityRole="alert" style={styles.errorBlock}>
                  <Text ref={mergeAlertRef} accessible style={styles.blockText}>
                    One of these records changed or is no longer available. Refresh and choose again.
                  </Text>
                </View>
                <View style={[styles.inlineActions, stacked && styles.stacked]}>
                  <Button label="Refresh" fullWidth onPress={props.onRetryPreview} />
                  <Button label="Cancel" variant="secondary" fullWidth onPress={closeMerge} />
                </View>
              </View>
            ) : props.preview ? (
              <ScrollView contentContainerStyle={styles.reviewContent}>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Choose the person to keep"
                  style={[styles.comparisonRow, stacked && styles.stacked]}
                >
                  <PersonComparisonCard
                    person={props.preview.left}
                    selected={survivorId === props.preview.left.personId}
                    selectable={props.preview.state === "ready"}
                    disambiguate={props.preview.left.displayName === props.preview.right.displayName}
                    onSelect={() => setSurvivorId(props.preview!.left.personId)}
                  />
                  <PersonComparisonCard
                    person={props.preview.right}
                    selected={survivorId === props.preview.right.personId}
                    selectable={props.preview.state === "ready"}
                    disambiguate={props.preview.left.displayName === props.preview.right.displayName}
                    onSelect={() => setSurvivorId(props.preview!.right.personId)}
                  />
                </View>
                {props.preview.hadPriorSeparation ? (
                  <View style={styles.warning}>
                    <Icon name="shield" size={20} color={semantic.warning} />
                    <View style={styles.blockCopy}>
                      <Text style={styles.warningTitle}>These people were separated before</Text>
                      <Text style={styles.blockText}>
                        Merging them again will supersede that decision and add a new entry to merge history.
                      </Text>
                    </View>
                  </View>
                ) : null}
                {mergeBlock(props.preview)}
                {resultFacts ? (
                  <GlassCard contentStyle={styles.mergedResult}>
                    <Text style={styles.resultTitle}>Merged result</Text>
                    <Text style={styles.resultName}>{resultFacts.name}</Text>
                    {resultFacts.email ? (
                      <View style={styles.resultField}>
                        <Text style={styles.fieldLabel}>Primary email</Text>
                        <Text style={styles.fieldValue}>{resultFacts.email}</Text>
                      </View>
                    ) : null}
                    {resultFacts.phone ? (
                      <View style={styles.resultField}>
                        <Text style={styles.fieldLabel}>Primary phone</Text>
                        <Text style={styles.fieldValue}>{resultFacts.phone}</Text>
                      </View>
                    ) : null}
                    {resultFacts.aliases.length > 0 ? (
                      <View style={styles.resultField}>
                        <Text style={styles.fieldLabel}>Also known as</Text>
                        <Text style={styles.fieldValue}>{resultFacts.aliases.join(", ")}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.subtitle}>
                      All other eligible emails and phones stay available.
                    </Text>
                  </GlassCard>
                ) : null}
                {mergeError ? (
                  <Text ref={mergeAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
                    {mergeError}
                  </Text>
                ) : null}
                {props.preview.state === "open_conflict" ? (
                  <Button label="Open Review" fullWidth onPress={props.onOpenReview} />
                ) : props.preview.state === "distinct_linked_users" ? (
                  <Button label="Done" variant="secondary" fullWidth onPress={props.onCloseMerge} />
                ) : null}
              </ScrollView>
            ) : null}
            {confirmMerge && stacked ? (
              <View style={styles.inlineConfirm} accessibilityViewIsModal>
                <Text
                  ref={mergeConfirmHeadingRef}
                  accessible
                  accessibilityRole="header"
                  style={styles.resultTitle}
                >
                  Merge into {survivorName}?
                </Text>
                <Text style={styles.blockText}>{mergeConfirmationDescription}</Text>
                {mergeError ? (
                  <Text ref={mergeAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
                    {mergeError}
                  </Text>
                ) : null}
                <View style={styles.stacked}>
                  <Button
                    label="Go back"
                    variant="secondary"
                    fullWidth
                    disabled={props.mergePending}
                    onPress={() => {
                      setConfirmMerge(false);
                      focusAfterLayout(mergeConfirmTriggerRef as React.RefObject<FocusTarget | null>);
                    }}
                  />
                  <Button
                    label={`Merge into ${survivorName}`}
                    variant="destructive"
                    fullWidth
                    loading={props.mergePending}
                    disabled={props.mergePending}
                    onPress={() => void submitMerge()}
                  />
                </View>
              </View>
            ) : null}
            {(props.preview?.state === "ready" || props.previewLoading || !props.preview) &&
                !(confirmMerge && stacked) ? (
              <View style={styles.footer}>
                <Button
                  ref={mergeConfirmTriggerRef}
                  label="Review merge"
                  size="lg"
                  fullWidth
                  disabled={!props.online || props.preview?.state !== "ready" || survivorId === null}
                  onPress={() => setConfirmMerge(true)}
                />
              </View>
            ) : null}
          </View>
        )}
      </Sheet>

      <ConfirmDialog
        visible={confirmMerge && !stacked}
        onClose={() => setConfirmMerge(false)}
        onConfirm={submitMerge}
        title={`Merge into ${survivorName}?`}
        description={mergeConfirmationDescription}
        confirmLabel={`Merge into ${survivorName}`}
        cancelLabel="Go back"
        destructive
        confirmLoading={props.mergePending}
        closeDisabled={props.mergePending}
        errorMessage={mergeError}
        initialFocus="cancel"
        restoreFocus={() => focusAfterLayout(mergeConfirmTriggerRef as React.RefObject<FocusTarget | null>)}
      />

      <Sheet
        visible={props.splitVisible}
        onClose={props.splitPending ? () => undefined : props.onCloseSplit}
        snapPoint="full"
        dismissOnScrimTap={!props.splitPending}
      >
        {splitResult?.outcome === "reversed" ? (
          <IdentityOperationReceipt
            kind="split"
            onPrimary={() => {
              props.onViewPeople();
              void props.onAcknowledgeReceipt?.();
            }}
          />
        ) : splitResult?.outcome === "escalated" ? (
          <IdentityOperationReceipt
            kind="unsafe"
            supportReference={splitResult.supportReference}
            onEmailSupport={() => props.onEmailSupport(splitResult.supportReference)}
            onDone={() => {
              props.onCloseSplit();
              void props.onAcknowledgeReceipt?.();
            }}
          />
        ) : splitUnsafeReference !== null ? (
          <IdentityOperationReceipt
            kind="unsafe"
            supportReference={splitUnsafeReference}
            onEmailSupport={() => props.onEmailSupport(splitUnsafeReference)}
            onDone={props.onCloseSplit}
          />
        ) : (
          <View style={styles.sheetBody}>
            <Header
              ref={splitHeadingRef}
              title="Split this merge?"
              subtitle="Two people will reappear in your book. Future contact, group, invite, and suppression behavior returns to the saved partition. Past orders, tickets, RSVPs, bookings, payments, and sends do not change."
              onClose={props.onCloseSplit}
              closeDisabled={props.splitPending}
              stacked={stacked}
            />
            {props.splitLoading ? (
              <View accessibilityLiveRegion="polite" style={[styles.comparisonRow, stacked && styles.stacked]}>
                <Skeleton width={stacked ? "100%" : "48%"} height={240} />
                <Skeleton width={stacked ? "100%" : "48%"} height={240} />
              </View>
            ) : props.splitError ? (
              <View style={styles.blockStack}>
                <Text ref={splitAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
                  Mingla couldn’t confirm the latest Split status. Nothing has changed.
                </Text>
                <Button label="Try again" variant="secondary" onPress={props.onRetrySplitPreview} />
              </View>
            ) : props.splitPreview?.state === "safe" ? (
              <ScrollView contentContainerStyle={styles.reviewContent}>
                <Text style={styles.sectionLabel}>After Split</Text>
                <View style={[styles.comparisonRow, stacked && styles.stacked]}>
                  <PersonComparisonCard person={props.splitPreview.left} />
                  <PersonComparisonCard person={props.splitPreview.right} />
                </View>
                <View style={styles.neutralCallout}>
                  <Text style={styles.blockText}>
                    Past orders, tickets, RSVPs, bookings, payments, and sends do not change.
                  </Text>
                </View>
                {!props.online ? (
                  <Text accessibilityRole="alert" style={styles.inlineError}>
                    You’re offline. Reconnect to continue. Nothing has changed.
                  </Text>
                ) : null}
                {splitMutationError ? (
                  <Text ref={splitAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
                    {splitMutationError}
                  </Text>
                ) : null}
              </ScrollView>
            ) : null}
            {confirmSplit && stacked ? (
              <View style={styles.inlineConfirm} accessibilityViewIsModal>
                <Text
                  ref={splitConfirmHeadingRef}
                  accessible
                  accessibilityRole="header"
                  style={styles.resultTitle}
                >
                  Split this merge?
                </Text>
                <Text style={styles.blockText}>
                  Two people will reappear in your book. Past orders, tickets, RSVPs, bookings, payments, and sends do not change.
                </Text>
                {splitMutationError ? (
                  <Text ref={splitAlertRef} accessible accessibilityRole="alert" style={styles.inlineError}>
                    {splitMutationError}
                  </Text>
                ) : null}
                <View style={styles.stacked}>
                  <Button
                    label="Go back"
                    variant="secondary"
                    fullWidth
                    disabled={props.splitPending}
                    onPress={() => {
                      setConfirmSplit(false);
                      focusAfterLayout(splitConfirmTriggerRef as React.RefObject<FocusTarget | null>);
                    }}
                  />
                  <Button
                    label="Split into two people"
                    fullWidth
                    loading={props.splitPending}
                    disabled={props.splitPending}
                    onPress={() => void submitSplit()}
                  />
                </View>
              </View>
            ) : null}
            {props.splitPreview?.state === "safe" && !(confirmSplit && stacked) ? <View style={styles.footer}>
              <Button
                ref={splitConfirmTriggerRef}
                label="Split into two people"
                size="lg"
                fullWidth
                disabled={!props.online || props.splitPreview?.state !== "safe"}
                onPress={() => setConfirmSplit(true)}
              />
            </View> : null}
          </View>
        )}
      </Sheet>

      <ConfirmDialog
        visible={confirmSplit && !stacked}
        onClose={() => setConfirmSplit(false)}
        onConfirm={submitSplit}
        title="Split this merge?"
        description="Two people will reappear in your book. Past orders, tickets, RSVPs, bookings, payments, and sends do not change."
        confirmLabel="Split into two people"
        cancelLabel="Go back"
        confirmLoading={props.splitPending}
        closeDisabled={props.splitPending}
        errorMessage={splitMutationError}
        initialFocus="cancel"
        restoreFocus={() => focusAfterLayout(splitConfirmTriggerRef as React.RefObject<FocusTarget | null>)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheetBody: { flex: 1, padding: spacing.md, gap: spacing.md, maxWidth: 640, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  headerCopy: { flex: 1, gap: spacing.xs },
  title: { ...typography.h2, color: text.primary },
  subtitle: { ...typography.bodySm, color: text.secondary },
  currentCard: {
    minHeight: 72,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: Platform.OS === "android" ? androidOpaque.rowFill : glass.tint.profileBase,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileBase,
  },
  currentCopy: { flex: 1 },
  currentLabel: { ...typography.caption, color: text.secondary },
  currentName: { ...typography.bodySm, fontWeight: "600", color: text.primary },
  currentContact: { ...typography.monoMd, color: text.secondary },
  candidateRow: {
    minHeight: 72,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: Platform.OS === "android" ? androidOpaque.rowFill : glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileElevated,
  },
  candidatePressed: { opacity: 0.72 },
  candidateCopy: { flex: 1, gap: 2 },
  candidateName: { ...typography.bodySm, fontWeight: "600", color: text.primary },
  candidateContact: { ...typography.bodySm, color: text.secondary },
  matchedContact: { ...typography.bodySm, fontWeight: "600", color: accent.warm },
  skeletons: { gap: spacing.sm },
  results: { gap: spacing.sm, paddingBottom: spacing.lg },
  paginationError: { alignItems: "center", gap: spacing.xs, padding: spacing.sm },
  blockStack: { gap: spacing.md },
  inlineActions: { flexDirection: "row", gap: spacing.sm },
  empty: { alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { ...typography.body, fontWeight: "600", color: text.primary, textAlign: "center" },
  comparisonRow: { flexDirection: "row", alignItems: "stretch", gap: spacing.md },
  stacked: { flexDirection: "column", gap: spacing.sm },
  reviewContent: { gap: spacing.md, paddingBottom: spacing.lg },
  warning: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.warning,
    backgroundColor: Platform.OS === "android" ? androidOpaque.warningFill : semantic.warningTint,
    padding: spacing.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  warningTitle: { ...typography.bodySm, fontWeight: "600", color: semantic.warning },
  errorBlock: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint,
    padding: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
  },
  blockCopy: { flex: 1, gap: spacing.xs },
  blockText: { ...typography.bodySm, color: text.primary, flex: 1 },
  mergedResult: { gap: spacing.sm },
  resultTitle: { ...typography.h3, color: text.primary },
  resultName: { ...typography.body, fontWeight: "600", color: text.primary },
  resultField: { gap: 2, paddingTop: spacing.xs },
  fieldLabel: { ...typography.caption, color: text.secondary },
  fieldValue: { ...typography.monoMd, color: text.primary },
  inlineError: { ...typography.bodySm, color: semantic.error },
  receiptError: {
    margin: spacing.md,
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileBase,
    backgroundColor: Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint,
  },
  inlineConfirm: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? androidOpaque.rowBorder : glass.border.profileBase,
    backgroundColor: Platform.OS === "android" ? androidOpaque.rowFill : glass.tint.profileElevated,
  },
  footer: { borderTopWidth: 1, borderTopColor: glass.border.profileBase, paddingTop: 12 },
  sectionLabel: { ...typography.labelCap, color: text.secondary },
  neutralCallout: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: Platform.OS === "android" ? androidOpaque.rowFill : glass.tint.profileBase,
    padding: spacing.md,
  },
  largeTextRow: { flexDirection: "column", alignItems: "stretch" },
});
