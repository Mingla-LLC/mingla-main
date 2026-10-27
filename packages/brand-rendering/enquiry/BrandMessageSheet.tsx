/**
 * #4111 — the smart message sheet (D5), shared by buyer web, Business preview
 * and Explorer. Pure presentational: the host passes the topic groups
 * (`buildEnquiryTopicGroups`), who is writing, and an `onSend` transport
 * (signed-in → RPC `brand_enquiry_send`; signed-out web → edge
 * `public-brand-enquiry`). The sheet never talks to the network itself.
 *
 *   Step 1  What's this about?   groups from the brand's own offerings + plans
 *   Step 2  What do you need?    reasons for the pick (+ self-serve first)
 *   Step 3  the message          shown under the reasons once one is picked
 *   Sent    confirmation         (or the host's `onSent` navigates away)
 *
 * A prefill ({contextKind, contextId}) opens straight at step 2. The sheet
 * sits at bottom 0 with no privacy inset: the buyer-web privacy bar stacks
 * below sheets and dialogs (#2331 coordination).
 *
 * Mount it lazily (React.lazy on this deep path) so it never weighs on a
 * page's first paint; it is only needed after a Message tap.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import type { LucideIcon } from "lucide-react-native";
import {
  CalendarCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  HelpCircle,
  Sparkles,
  Ticket,
  UsersRound,
  UtensilsCrossed,
  X as XIcon,
} from "lucide-react-native";
import {
  createThemePalette,
  type ResolvedTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";

import {
  ENQUIRY_BODY_MAX,
  ENQUIRY_BODY_MIN,
  composeEnquiryBody,
  resolveEnquiryPrefill,
  selfServeFor,
  sendReasonFor,
  validateEnquiryDraft,
  type EnquiryEntry,
  type EnquiryGroup,
  type EnquiryPick,
  type EnquiryPrefill,
  type EnquiryReason,
  type EnquiryReasonKey,
  type EnquirySendOutcome,
  type EnquirySendRequest,
  type TableRequestDetails,
} from "./enquiryTopics";

export type EnquiryViewer =
  | { kind: "signed_in"; name: string }
  | { kind: "signed_out_web" };

export interface EnquiryPhoneState {
  e164: string | null;
  isEmpty: boolean;
  valid: boolean;
}

export interface EnquiryPhoneFieldArgs {
  testID: string;
  accessibilityLabel: string;
  placeholder: string;
  palette: ThemePalette;
  onChange: (state: EnquiryPhoneState) => void;
}

export interface BrandMessageSheetProps {
  visible: boolean;
  onClose: () => void;
  brandName: string;
  theme: ResolvedTheme;
  groups: ReadonlyArray<EnquiryGroup>;
  viewer: EnquiryViewer;
  entry: EnquiryEntry;
  /** Opens at step 2 with this pick. */
  prefill?: EnquiryPrefill | null;
  /** Signed-in plan lookup state; "loading" shows a row under step 1. */
  plansState?: "idle" | "loading" | "ready" | "error";
  onRetryPlans?: () => void;
  onSend: (request: EnquirySendRequest) => Promise<EnquirySendOutcome>;
  /**
   * Called after a successful send. Explorer navigates to the thread here and
   * passes `closeOnSent` so the sheet does not show its own sent screen.
   */
  onSent?: (outcome: Extract<EnquirySendOutcome, { ok: true }>, request: EnquirySendRequest) => void;
  closeOnSent?: boolean;
  onViewConversation?: (outcome: Extract<EnquirySendOutcome, { ok: true }>) => void;
  /** Signed-out web: "Already booked? … Open app". Hidden when absent. */
  onOpenApp?: () => void;
  /** "Your tickets are in Likes → Calendar" Open button (Explorer). */
  onOpenCalendar?: () => void;
  onCancelSelf?: (pick: EnquiryPick, url: string | null) => void;
  onRequestRefund?: (pick: EnquiryPick) => void;
  onBookTable?: (pick: EnquiryPick) => void;
  /** Signed-out: the host's phone field (country picker). Hidden when absent. */
  renderPhoneField?: (args: EnquiryPhoneFieldArgs) => React.ReactElement;
  testID?: string;
}

type Step = "topic" | "reason" | "sent";

const PLAN_CONTEXTS = new Set(["order", "rsvp", "reservation", "stay", "venue_order"]);

const PICK_ICON: Record<EnquiryPick["icon"], LucideIcon> = {
  plan: CalendarCheck,
  offering: Ticket,
  table: UtensilsCrossed,
  party: UsersRound,
  food: UtensilsCrossed,
  question: HelpCircle,
  collab: Sparkles,
  other: Ellipsis,
};

const nowMs = (): number => Date.now();

export const BrandMessageSheet = ({
  visible,
  onClose,
  brandName,
  theme,
  groups,
  viewer,
  entry,
  prefill = null,
  plansState = "idle",
  onRetryPlans,
  onSend,
  onSent,
  closeOnSent = false,
  onViewConversation,
  onOpenApp,
  onOpenCalendar,
  onCancelSelf,
  onRequestRefund,
  onBookTable,
  renderPhoneField,
  testID = "brand-message-sheet",
}: BrandMessageSheetProps): React.ReactElement => {
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  const themedFont = { fontFamily: theme.fontFamilyValue };
  const signedIn = viewer.kind === "signed_in";

  const [step, setStep] = useState<Step>("topic");
  const [pick, setPick] = useState<EnquiryPick | null>(null);
  const [reason, setReason] = useState<EnquiryReasonKey | null>(null);
  const [askInstead, setAskInstead] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState<EnquiryPhoneState>({ e164: null, isEmpty: true, valid: false });
  const [okToCall, setOkToCall] = useState(false);
  const [table, setTable] = useState<TableRequestDetails>({});
  const [hp, setHp] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<Extract<EnquirySendOutcome, { ok: true }> | null>(null);
  const openedAt = useRef<number>(nowMs());

  const resetFor = useCallback(
    (next: EnquiryPick | null, nextReason: EnquiryReasonKey | null): void => {
      setPick(next);
      setReason(nextReason);
      setAskInstead(false);
      setSendError(null);
      setShowErrors(false);
      setTable({});
      setStep(next === null ? "topic" : "reason");
    },
    [],
  );

  // Opening (or a new prefill) starts over: step 2 for a prefill, else step 1.
  const prefillKey = prefill === null ? "" : `${prefill.contextKind}:${prefill.contextId}:${prefill.reason ?? ""}`;
  useEffect(() => {
    if (!visible) return;
    openedAt.current = nowMs();
    setSent(null);
    setSending(false);
    setBody("");
    setHp("");
    setOkToCall(false);
    setExpanded({});
    const start = resolveEnquiryPrefill(groups, prefill);
    const startReason =
      start !== null && prefill?.reason !== undefined && start.reasons.some((r) => r.key === prefill.reason)
        ? prefill.reason
        : null;
    resetFor(start, startReason);
    // groups is read once per opening; a later plans load must not reset a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, prefillKey, resetFor]);

  // "Already booked?" only makes sense when the brand offers something that
  // can be booked (P2-1): a brand with nothing listed shows only "Something else".
  const brandHasOfferings = groups.some((g) => g.key !== "something_else" && g.key !== "plans");
  const chosenReason = pick === null ? null : sendReasonFor(pick, reason);
  const selfServe = pick === null ? null : selfServeFor(pick, reason);
  const gatesCompose =
    !askInstead &&
    selfServe !== null &&
    ((selfServe.kind === "cancel_self" && onCancelSelf !== undefined) ||
      (selfServe.kind === "request_refund" && onRequestRefund !== undefined));
  const showCompose = pick !== null && chosenReason !== null && !gatesCompose;

  const phoneEntered = !phone.isEmpty;
  const callAllowed = phoneEntered && phone.valid;
  useEffect(() => {
    if (!callAllowed && okToCall) setOkToCall(false);
  }, [callAllowed, okToCall]);

  const draftErrors = validateEnquiryDraft({
    body,
    signedIn,
    name,
    email,
    phoneInvalid: phoneEntered && !phone.valid,
  });
  const errorFor = (key: (typeof draftErrors)[number]): boolean => showErrors && draftErrors.includes(key);

  const submit = async (): Promise<void> => {
    if (pick === null || chosenReason === null || sending) return;
    if (draftErrors.length > 0) {
      setShowErrors(true);
      return;
    }
    const request: EnquirySendRequest = {
      entry,
      contextKind: pick.contextKind,
      contextId: pick.contextId,
      reason: chosenReason,
      body: composeEnquiryBody(body, pick.shape === "table" ? table : null),
      guest: signedIn
        ? null
        : {
            name: name.trim(),
            email: email.trim(),
            phoneE164: phone.valid ? phone.e164 : null,
            okToCall: callAllowed && okToCall,
          },
      hp,
      t0: openedAt.current,
    };
    setSending(true);
    setSendError(null);
    try {
      const outcome = await onSend(request);
      if (!outcome.ok) {
        setSendError(outcome.message);
        return;
      }
      onSent?.(outcome, request);
      if (closeOnSent) {
        onClose();
        return;
      }
      setSent(outcome);
      setStep("sent");
    } catch (error: unknown) {
      setSendError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "We couldn't send that. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const disclosure = signedIn
    ? `Sending as ${viewer.kind === "signed_in" ? viewer.name : ""}. ${brandName} will see your name and email${
        pick !== null && PLAN_CONTEXTS.has(pick.contextKind) ? " and this booking" : ""
      }.`
    : `${brandName} will see your name and email. Mingla delivers your messages and only reads one if it's reported.`;

  // ---- pieces --------------------------------------------------------------
  const primaryButton = (
    label: string,
    onPress: () => void,
    opts: { testID: string; disabled?: boolean; busy?: boolean; flex?: boolean } = { testID: "" },
  ): React.ReactElement => (
    <Pressable
      onPress={onPress}
      disabled={opts.disabled === true || opts.busy === true}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: opts.disabled === true, busy: opts.busy === true }}
      testID={opts.testID}
      style={({ pressed }) => [
        styles.primaryBtn,
        opts.flex === true && styles.flexBtn,
        { backgroundColor: palette.accent },
        (opts.disabled === true || opts.busy === true) && styles.dim,
        pressed && styles.pressed,
      ]}
    >
      {opts.busy === true ? (
        <ActivityIndicator color={palette.accentText} />
      ) : (
        <Text numberOfLines={2} style={[styles.primaryLabel, { color: palette.accentText }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );

  const secondaryButton = (
    label: string,
    onPress: () => void,
    opts: { testID: string; flex?: boolean; compact?: boolean } = { testID: "" },
  ): React.ReactElement => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={opts.testID}
      style={({ pressed }) => [
        opts.compact === true ? styles.compactBtn : styles.secondaryBtn,
        opts.flex === true && styles.flexBtn,
        { borderColor: palette.accent },
        pressed && styles.pressed,
      ]}
    >
      <Text
        numberOfLines={2}
        style={[opts.compact === true ? styles.compactLabel : styles.secondaryLabel, { color: palette.primaryText }]}
      >
        {label}
      </Text>
    </Pressable>
  );

  const pickRow = (item: EnquiryPick): React.ReactElement => {
    const Icon = PICK_ICON[item.icon];
    return (
      <Pressable
        key={item.key}
        onPress={() => resetFor(item, null)}
        accessibilityRole="button"
        accessibilityLabel={item.subtitle === null ? item.title : `${item.title}, ${item.subtitle}`}
        testID={`${testID}-pick-${item.key}`}
        style={({ pressed }) => [
          styles.pickRow,
          { backgroundColor: palette.card, borderColor: palette.panelBorder },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.pickIcon, { backgroundColor: palette.accentWash }]}>
          <Icon size={18} color={palette.accent} />
        </View>
        <View style={styles.pickCopy}>
          <Text numberOfLines={2} style={[styles.pickTitle, { color: palette.primaryText }]}>
            {item.title}
          </Text>
          {item.subtitle !== null ? (
            <Text numberOfLines={1} style={[styles.pickSub, { color: palette.tertiaryText }]}>
              {item.subtitle}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={palette.tertiaryText} />
      </Pressable>
    );
  };

  const input = (
    value: string,
    onChangeText: (next: string) => void,
    opts: {
      label: string;
      testID: string;
      invalid?: boolean;
      multiline?: boolean;
      keyboardType?: "default" | "email-address" | "number-pad";
      autoComplete?: "name" | "email" | "off";
      maxLength?: number;
      style?: object;
    },
  ): React.ReactElement => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={opts.label}
      placeholderTextColor={palette.tertiaryText}
      accessibilityLabel={opts.label}
      testID={opts.testID}
      multiline={opts.multiline === true}
      keyboardType={opts.keyboardType ?? "default"}
      autoComplete={opts.autoComplete ?? "off"}
      autoCapitalize={opts.keyboardType === "email-address" ? "none" : "sentences"}
      autoCorrect={opts.keyboardType !== "email-address"}
      maxLength={opts.maxLength}
      style={[
        styles.input,
        opts.multiline === true && styles.inputArea,
        {
          color: palette.primaryText,
          backgroundColor: palette.card,
          borderColor: opts.invalid === true ? "#ef4444" : palette.panelBorder,
        },
        opts.style,
      ]}
    />
  );

  const fieldError = (show: boolean, copy: string): React.ReactElement | null =>
    show ? (
      <Text accessibilityLiveRegion="polite" style={styles.errorText}>
        {copy}
      </Text>
    ) : null;

  // ---- step 1 ----------------------------------------------------------------
  const topicStep = (
    <View>
      <Text style={[styles.title, themedFont, { color: palette.primaryText }]} accessibilityRole="header">
        {`Message ${brandName}`}
      </Text>
      <Text style={[styles.sub, { color: palette.secondaryText }]}>What&apos;s this about?</Text>
      {!signedIn && onOpenApp !== undefined && brandHasOfferings ? (
        <View
          style={[styles.appRow, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}
          testID={`${testID}-open-app-row`}
        >
          <Text style={[styles.appRowCopy, { color: palette.secondaryText }]}>
            {`Already booked? Message from the Mingla app so ${brandName} sees your booking.`}
          </Text>
          {secondaryButton("Open app", onOpenApp, { testID: `${testID}-open-app`, compact: true })}
        </View>
      ) : null}
      {signedIn && plansState === "loading" ? (
        <View style={styles.inlineState} testID={`${testID}-plans-loading`}>
          <ActivityIndicator color={palette.accent} />
          <Text style={[styles.inlineStateText, { color: palette.tertiaryText }]}>Finding your plans…</Text>
        </View>
      ) : null}
      {signedIn && plansState === "error" ? (
        <View style={styles.inlineState} testID={`${testID}-plans-error`}>
          <Text style={[styles.inlineStateText, { color: palette.tertiaryText }]}>
            Couldn&apos;t load your plans.
          </Text>
          {onRetryPlans !== undefined
            ? secondaryButton("Try again", onRetryPlans, { testID: `${testID}-plans-retry`, compact: true })
            : null}
        </View>
      ) : null}
      {groups.map((group) => {
        const open = expanded[group.key] === true;
        const picks = open ? [...group.picks, ...group.hiddenPicks] : group.picks;
        if (picks.length === 0) return null;
        return (
          <View key={group.key} style={styles.group} testID={`${testID}-group-${group.key}`}>
            <Text style={[styles.groupTitle, { color: palette.tertiaryText }]} accessibilityRole="header">
              {group.title}
            </Text>
            <View style={styles.pickList}>{picks.map(pickRow)}</View>
            {!open && group.hiddenPicks.length > 0
              ? secondaryButton(`See all (${group.picks.length + group.hiddenPicks.length})`, () =>
                  setExpanded((prev: Record<string, boolean>) => ({ ...prev, [group.key]: true })), {
                  testID: `${testID}-see-all-${group.key}`,
                  compact: true,
                })
              : null}
          </View>
        );
      })}
    </View>
  );

  // ---- step 2 + 3 ------------------------------------------------------------
  const selfServeBlock =
    pick === null || selfServe === null ? null : selfServe.kind === "find_tickets" ? (
      <View style={[styles.hintCard, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}>
        <Text style={[styles.hintText, { color: palette.primaryText }]}>
          Your tickets are in Likes → Calendar
        </Text>
        {onOpenCalendar !== undefined
          ? secondaryButton("Open", onOpenCalendar, { testID: `${testID}-open-calendar`, compact: true })
          : null}
      </View>
    ) : selfServe.kind === "refund_policy" ? (
      <View style={[styles.hintCard, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}>
        <Text style={[styles.hintText, { color: palette.primaryText }]}>{selfServe.line}</Text>
      </View>
    ) : selfServe.kind === "book_table" && onBookTable !== undefined ? (
      <View style={[styles.hintCard, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}>
        <Text style={[styles.hintText, { color: palette.primaryText }]}>
          {`${pick.venue?.name ?? brandName} takes reservations online.`}
        </Text>
        {secondaryButton("Book now", () => onBookTable(pick), { testID: `${testID}-book-now`, compact: true })}
      </View>
    ) : gatesCompose ? (
      <View style={styles.actionRow}>
        {selfServe.kind === "cancel_self" && onCancelSelf !== undefined
          ? primaryButton("Cancel it yourself", () => onCancelSelf(pick, selfServe.url), {
              testID: `${testID}-cancel-self`,
              flex: true,
            })
          : null}
        {selfServe.kind === "request_refund" && onRequestRefund !== undefined
          ? primaryButton("Request refund", () => onRequestRefund(pick), {
              testID: `${testID}-request-refund`,
              flex: true,
            })
          : null}
        {secondaryButton(`Ask ${brandName} instead`, () => setAskInstead(true), {
          testID: `${testID}-ask-instead`,
          flex: true,
        })}
      </View>
    ) : null;

  const compose = !showCompose ? null : (
    <View style={styles.compose} testID={`${testID}-compose`}>
      {pick?.shape === "table" ? (
        <View style={styles.tableRow}>
          {input(table.date ?? "", (v: string) => setTable((t: TableRequestDetails) => ({ ...t, date: v })), {
            label: "Date",
            testID: `${testID}-table-date`,
            maxLength: 40,
            style: styles.tableField,
          })}
          {input(table.time ?? "", (v: string) => setTable((t: TableRequestDetails) => ({ ...t, time: v })), {
            label: "Time",
            testID: `${testID}-table-time`,
            maxLength: 20,
            style: styles.tableField,
          })}
          {input(table.partySize ?? "", (v: string) => setTable((t: TableRequestDetails) => ({ ...t, partySize: v.replace(/[^0-9]/g, "") })), {
            label: "Party size",
            testID: `${testID}-table-party`,
            keyboardType: "number-pad",
            maxLength: 3,
            style: styles.tableField,
          })}
        </View>
      ) : null}
      {input(body, setBody, {
        label: "Message",
        testID: `${testID}-body`,
        multiline: true,
        maxLength: ENQUIRY_BODY_MAX,
        invalid: errorFor("body_short") || errorFor("body_long"),
      })}
      {fieldError(errorFor("body_short"), `Write at least ${ENQUIRY_BODY_MIN} characters.`)}
      {!signedIn ? (
        <>
          {input(name, setName, {
            label: "Your name",
            testID: `${testID}-name`,
            autoComplete: "name",
            maxLength: 80,
            invalid: errorFor("name"),
          })}
          {fieldError(errorFor("name"), "Enter your name.")}
          {input(email, setEmail, {
            label: "Email for replies",
            testID: `${testID}-email`,
            keyboardType: "email-address",
            autoComplete: "email",
            maxLength: 254,
            invalid: errorFor("email"),
          })}
          {fieldError(errorFor("email"), "Enter a full email address, like name@example.com.")}
          {renderPhoneField !== undefined ? (
            <>
              {renderPhoneField({
                testID: `${testID}-phone`,
                accessibilityLabel: "Phone (optional)",
                placeholder: "Phone (optional)",
                palette,
                onChange: setPhone,
              })}
              <Pressable
                onPress={() => {
                  if (callAllowed) setOkToCall((v: boolean) => !v);
                }}
                disabled={!callAllowed}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: okToCall, disabled: !callAllowed }}
                accessibilityLabel={`OK for ${brandName} to call me about this`}
                testID={`${testID}-ok-to-call`}
                style={[styles.checkRow, !callAllowed && styles.dim]}
              >
                <View
                  style={[
                    styles.checkBox,
                    { borderColor: okToCall ? palette.accent : palette.panelBorder },
                    okToCall && { backgroundColor: palette.accent },
                  ]}
                >
                  {okToCall ? <Check size={14} color={palette.accentText} /> : null}
                </View>
                <Text style={[styles.checkLabel, { color: palette.secondaryText }]}>
                  {`OK for ${brandName} to call me about this`}
                </Text>
              </Pressable>
            </>
          ) : null}
          {/* Honeypot: invisible to people, filled only by bots. */}
          <TextInput
            value={hp}
            onChangeText={setHp}
            accessibilityElementsHidden
            aria-hidden
            tabIndex={-1}
            focusable={false}
            importantForAccessibility="no-hide-descendants"
            autoComplete="off"
            testID={`${testID}-hp`}
            style={styles.honeypot}
          />
        </>
      ) : null}
      <Text style={[styles.disclosure, { color: palette.tertiaryText }]} testID={`${testID}-disclosure`}>
        {disclosure}
      </Text>
      {sendError !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorText} testID={`${testID}-send-error`}>
          {sendError}
        </Text>
      ) : null}
      {primaryButton("Send message", () => {
        void submit();
      }, { testID: `${testID}-send`, busy: sending })}
    </View>
  );

  const reasonStep =
    pick === null ? null : (
      <View>
        <Pressable
          onPress={() => resetFor(null, null)}
          accessibilityRole="button"
          accessibilityLabel={`Back to topics. ${pick.title}`}
          testID={`${testID}-back`}
          style={({ pressed }) => [styles.backRow, pressed && styles.pressed]}
        >
          <ChevronLeft size={18} color={palette.secondaryText} />
          <Text numberOfLines={1} style={[styles.backLabel, { color: palette.secondaryText }]}>
            {pick.subtitle === null ? pick.title : `${pick.title} · ${pick.subtitle}`}
          </Text>
        </Pressable>
        <Text style={[styles.title, themedFont, { color: palette.primaryText }]} accessibilityRole="header">
          {pick.reasons.length > 0 ? "What do you need?" : pick.title}
        </Text>
        {pick.reasons.length > 0 ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {pick.reasons.map((r: EnquiryReason) => {
              const on = reason === r.key;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => {
                    setReason(r.key);
                    setAskInstead(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  accessibilityLabel={r.label}
                  testID={`${testID}-reason-${r.key}`}
                  style={({ pressed }) => [
                    styles.chip,
                    on
                      ? { backgroundColor: palette.accent, borderColor: palette.accent }
                      : { backgroundColor: palette.card, borderColor: palette.panelBorder },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, { color: on ? palette.accentText : palette.primaryText }]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {selfServeBlock}
        {compose}
      </View>
    );

  const sentStep =
    sent === null ? null : (
      <View style={styles.sentWrap} testID={`${testID}-sent`}>
        <View style={[styles.sentIcon, { backgroundColor: palette.accentWash }]}>
          <Check size={26} color={palette.accent} />
        </View>
        <Text style={[styles.title, styles.center, themedFont, { color: palette.primaryText }]}>
          {`Message sent to ${brandName}`}
        </Text>
        <Text style={[styles.sub, styles.center, { color: palette.secondaryText }]}>
          {sent.email !== null
            ? `We emailed ${sent.email} a link to this conversation. Replies arrive there too.`
            : "Replies arrive in the Mingla app, in your Friends tab."}
        </Text>
        <View style={styles.actionRow}>
          {onViewConversation !== undefined && (sent.threadUrl !== null || sent.conversationId !== null)
            ? primaryButton("View conversation", () => onViewConversation(sent), {
                testID: `${testID}-view-conversation`,
                flex: true,
              })
            : null}
          {secondaryButton("Done", onClose, { testID: `${testID}-done`, flex: true })}
        </View>
      </View>
    );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === "web" ? "fade" : "slide"}
      onRequestClose={onClose}
      testID={testID}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          testID={`${testID}-scrim`}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.sheetWrap, wide && styles.sheetWrapWide]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.sheet,
              wide && styles.sheetWide,
              { backgroundColor: palette.page, borderColor: palette.panelBorder, maxHeight: Math.round(height * 0.9) },
            ]}
            accessibilityViewIsModal
          >
            <View style={styles.headerRow}>
              <View style={[styles.grab, { backgroundColor: palette.panelBorder }]} />
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                testID={`${testID}-close`}
                style={({ pressed }) => [styles.closeBtn, { backgroundColor: palette.card }, pressed && styles.pressed]}
              >
                <XIcon size={18} color={palette.primaryText} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollBody}
              showsVerticalScrollIndicator={false}
            >
              {step === "sent" ? sentStep : step === "reason" ? reasonStep : topicStep}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

export default BrandMessageSheet;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheetWrap: { width: "100%", justifyContent: "flex-end" },
  sheetWrapWide: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingBottom: 12,
    overflow: "hidden",
  },
  sheetWide: { maxWidth: 560, borderRadius: 22, borderBottomWidth: 1 },
  headerRow: { height: 44, alignItems: "center", justifyContent: "center" },
  grab: { width: 40, height: 4, borderRadius: 2 },
  closeBtn: {
    position: "absolute",
    right: 12,
    top: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollBody: { paddingHorizontal: 20, paddingBottom: 28 },
  title: { fontSize: 21, lineHeight: 27, fontWeight: "700", marginBottom: 4 },
  sub: { fontSize: 15, lineHeight: 21, marginBottom: 12 },
  center: { textAlign: "center" },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  appRowCopy: { flex: 1, fontSize: 13, lineHeight: 18 },
  inlineState: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  inlineStateText: { flex: 1, fontSize: 14, lineHeight: 20 },
  group: { marginTop: 14, gap: 8 },
  groupTitle: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  pickList: { gap: 8 },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 56,
  },
  pickIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pickCopy: { flex: 1, minWidth: 0 },
  pickTitle: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  pickSub: { fontSize: 13, lineHeight: 18, marginTop: 1 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 6, maxWidth: "100%" },
  backLabel: { fontSize: 14, lineHeight: 19, fontWeight: "600", flexShrink: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 38, justifyContent: "center" },
  chipLabel: { fontSize: 14, lineHeight: 19, fontWeight: "600" },
  hintCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
  },
  hintText: { flex: 1, fontSize: 14, lineHeight: 20 },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 16, alignSelf: "stretch" },
  compose: { marginTop: 16, gap: 10 },
  tableRow: { flexDirection: "row", gap: 8 },
  tableField: { flex: 1, minWidth: 0 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 21,
  },
  inputArea: { minHeight: 120, textAlignVertical: "top" },
  errorText: { color: "#ef4444", fontSize: 13, lineHeight: 18, marginTop: -4 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkLabel: { flex: 1, fontSize: 14, lineHeight: 19 },
  honeypot: { position: "absolute", left: -10000, top: 0, width: 1, height: 1, opacity: 0 },
  disclosure: { fontSize: 12, lineHeight: 17 },
  primaryBtn: {
    minHeight: 50,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryLabel: { fontSize: 16, lineHeight: 21, fontWeight: "700", textAlign: "center" },
  secondaryBtn: {
    minHeight: 50,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  secondaryLabel: { fontSize: 15, lineHeight: 20, fontWeight: "700", textAlign: "center" },
  compactBtn: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  compactLabel: { fontSize: 13, lineHeight: 18, fontWeight: "700", textAlign: "center" },
  flexBtn: { flex: 1 },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  sentWrap: { alignItems: "center", paddingTop: 8, gap: 6 },
  sentIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
});
