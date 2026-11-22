/**
 * #4490 P6-2 — one member (`mb-member`): plan and price, member since, paid
 * until, what's left this period (room hours, guest passes), the billing
 * timeline (what happened and what happens next), every period with how it
 * was paid, and visits. People who manage members send the payment link
 * again, pause, resume, end or keep a leaving member; people with money
 * rights mark a period paid at the venue. Each action replaces the body with
 * its own short form and asks once with the consequence (no stacked dialog).
 *
 * A side panel on wide web, a sheet on phones (Close + backdrop dismiss).
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useManageVenueMember, useVenueMember } from "../../../../hooks/useVenueMembers";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { ManageMemberAction, VenueMemberDetail } from "../../../../types/venueMembers";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { Icon, type IconName } from "../../../ui/Icon";
import { Input } from "../../../ui/Input";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Pill, Segmented } from "../../../ui/Pill";
import { SelectSheet } from "../../../ui/SelectSheet";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { Timeline } from "../../../ui/Timeline";
import { money } from "../offers/offersModel";
import { formatVenueMemberCode } from "../../../../utils/venueMemberCode";
import {
  billingSteps,
  hoursWords,
  memberDay,
  memberCanEnd,
  memberCanAssignDesk,
  memberErrorCopy,
  memberMonth,
  memberRequestState,
  memberStatusWords,
  periodWords,
  timelineWords,
} from "./membersModel";

type Mode = "view" | "pay" | "pause" | "end" | "request" | "desk";

export interface MemberPanelProps {
  brandId: string | null;
  venueId: string | null;
  subscriptionId: string | null;
  onClose: () => void;
  onToast: (text: string) => void;
}

export function MemberPanel({ brandId, venueId, subscriptionId, onClose, onToast }: MemberPanelProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => setMode("view"), [subscriptionId]);
  const close = (): void => {
    setMode("view");
    onClose();
  };
  return (
    <Sheet
      visible={subscriptionId !== null}
      onClose={close}
      snapPoint={0.9}
      presentation={isWideDesktop ? "panel" : undefined}
      testID="venue-member-panel"
    >
      {subscriptionId !== null ? (
        <MemberBody
          brandId={brandId}
          venueId={venueId}
          subscriptionId={subscriptionId}
          mode={mode}
          setMode={setMode}
          onClose={close}
          onToast={onToast}
          plainHead={isWideDesktop}
        />
      ) : null}
    </Sheet>
  );
}

interface BodyProps {
  brandId: string | null;
  venueId: string | null;
  subscriptionId: string;
  mode: Mode;
  setMode: (m: Mode) => void;
  onClose: () => void;
  onToast: (text: string) => void;
  plainHead: boolean;
}

function MemberBody({ brandId, venueId, subscriptionId, mode, setMode, onClose, onToast, plainHead }: BodyProps): React.ReactElement {
  const query = useVenueMember(brandId, venueId, subscriptionId);
  const manage = useManageVenueMember(brandId, venueId);
  const [error, setError] = useState<string | null>(null);
  const m = query.data;

  const act = (change: ManageMemberAction, done: string): void => {
    if (m === undefined) return;
    setError(null);
    manage.mutate(
      { subscriptionId, expectedVersion: m.version, change },
      {
        onSuccess: () => {
          setMode("view");
          onToast(done);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          if (err.code === "stale_write") void query.refetch();
          setError(memberErrorCopy(err.code, err.detail, m.plan.period));
        },
      },
    );
  };

  if (query.isLoading) {
    return (
      <View style={styles.body} testID="venue-member-loading" accessibilityLabel="Loading member">
        <PickerSheetHead title="Member" onClose={onClose} plain={plainHead} />
        <Skeleton height={24} width="60%" />
        <Skeleton height={120} radius="md" />
        <Skeleton height={160} radius="md" />
      </View>
    );
  }
  if (query.isError || m === undefined) {
    const err = query.error === null ? null : toVenueOfferError(query.error);
    return (
      <View style={styles.body} testID="venue-member-error">
        <PickerSheetHead title="Member" onClose={onClose} plain={plainHead} />
        <Text style={styles.title}>Couldn&apos;t load this member</Text>
        <Text style={styles.meta}>{err !== null && err.code !== "unknown" ? memberErrorCopy(err.code) : "Check your connection and try again."}</Text>
        <View>
          <Button label="Try again" variant="secondary" size="md" onPress={() => void query.refetch()} />
        </View>
      </View>
    );
  }

  if (mode === "pay") {
    return (
      <View style={styles.body}>
        <PickerSheetHead title={`Mark this ${m.plan.period} paid`} onClose={onClose} plain={plainHead} />
        <PayForm m={m} busy={manage.isPending} error={error} onBack={() => { setError(null); setMode("view"); }} onSubmit={(method, note) =>
          act({ action: "mark_paid", method, ...(note.length > 0 ? { note } : {}), ...(m.paymentDue !== null ? { periodId: m.paymentDue.periodId } : {}) }, `${m.memberName}'s ${m.plan.period} is marked paid`)
        } />
      </View>
    );
  }
  if (mode === "request") {
    return (
      <View style={styles.body}>
        <PickerSheetHead title={`${m.memberName}'s request`} onClose={onClose} plain={plainHead} />
        <RequestDecisionForm
          m={m}
          busy={manage.isPending}
          error={error}
          onBack={() => { setError(null); setMode("view"); }}
          onApprove={() => act({ action: "approve_request" }, `${m.memberName} is approved`)}
          onDecline={(reason) => act({ action: "decline_request", ...(reason.length > 0 ? { reason } : {}) }, `${m.memberName}'s request was declined`)}
        />
      </View>
    );
  }
  if (mode === "desk") {
    return (
      <View style={styles.body}>
        <PickerSheetHead title={`Assign a desk to ${m.memberName}`} onClose={onClose} plain={plainHead} />
        <DeskForm
          m={m}
          busy={manage.isPending}
          error={error}
          onBack={() => { setError(null); setMode("view"); }}
          onSubmit={(spaceId) => act({ action: "assign_desk", spaceId }, `Desk assigned to ${m.memberName}`)}
          onUnassign={() => act({ action: "unassign_desk" }, `${m.memberName}'s desk was unassigned`)}
        />
      </View>
    );
  }
  if (mode === "pause") {
    return (
      <View style={styles.body}>
        <PickerSheetHead title={`Pause ${m.memberName}`} onClose={onClose} plain={plainHead} />
        <WhenForm
          m={m}
          kind="pause"
          busy={manage.isPending}
          error={error}
          onBack={() => { setError(null); setMode("view"); }}
          onSubmit={(when, reason) =>
            act({ action: "pause", when, ...(reason.length > 0 ? { reason } : {}) }, when === "now" ? `${m.memberName} is paused` : `${m.memberName} pauses at the end of the ${m.plan.period}`)
          }
        />
      </View>
    );
  }
  if (mode === "end") {
    return (
      <View style={styles.body}>
        <PickerSheetHead title={`End ${m.memberName}'s membership`} onClose={onClose} plain={plainHead} />
        <WhenForm
          m={m}
          kind="end"
          busy={manage.isPending}
          error={error}
          onBack={() => { setError(null); setMode("view"); }}
          onSubmit={(when, reason) =>
            act({ action: "cancel", when, reason }, when === "now" ? `${m.memberName}'s membership has ended` : `${m.memberName}'s membership ends at the end of the ${m.plan.period}`)
          }
        />
      </View>
    );
  }

  const tz = m.venue.timezone;
  const yearly = m.plan.period === "year";
  const day = (iso: string | null | undefined): string => memberDay(iso ?? null, tz, yearly) ?? "—";
  const st = memberStatusWords(m.status, m.leaving?.endsAt ?? null);
  const steps = billingSteps(m);
  const due = m.paymentDue;
  const ended = m.status === "cancelled";
  const requestState = memberRequestState(m.status);
  const memberCode = formatVenueMemberCode(m.memberCode);
  const facts: { key: string; label: string; value: string }[] = [
    { key: "plan", label: "Plan", value: `${m.plan.name} · ${money(m.terms.priceMinor ?? m.plan.priceMinor, m.plan.currencyCode)} a ${m.plan.period}` },
    ...(memberCode !== null
      ? [{ key: "member-code", label: "Member code", value: memberCode }]
      : []),
    { key: "since", label: "Member since", value: memberMonth(m.startedAt ?? m.createdAt, tz) ?? "Not started yet" },
    { key: "until", label: ended ? "Ended" : "Paid until", value: ended ? day(m.endedAt) : m.activeUntil !== null ? day(m.activeUntil) : "Not paid yet" },
    ...(m.credits.roomHoursPerMonth > 0 && !ended
      ? [{ key: "rooms", label: "Room hours", value: `${hoursWords(m.credits.roomHoursLeft).replace(/ hours?$/, "")} of ${hoursWords(m.credits.roomHoursPerMonth)} left` }]
      : []),
    ...(m.credits.guestPassesPerMonth > 0 && !ended
      ? [{ key: "passes", label: "Guest passes", value: `${m.credits.guestPassesLeft} of ${m.credits.guestPassesPerMonth} left` }]
      : []),
    { key: "contact", label: "Contact", value: [m.email, m.phone].filter(Boolean).join(" · ") || "—" },
    ...(m.assignedSpace !== null ? [{ key: "desk", label: "Desk", value: m.assignedSpace.name }] : []),
    ...(m.terms.minMonths !== null && m.terms.minMonths > 1 ? [{ key: "min", label: "Minimum", value: m.plan.period === "year" ? "1 year" : `${m.terms.minMonths} months` }] : []),
    ...(m.terms.noticeDays !== null && m.terms.noticeDays > 0 ? [{ key: "notice", label: "Notice", value: `${m.terms.noticeDays} days` }] : []),
  ];
  const canPause = m.canManage && m.status === "active" && m.pausing === null && m.leaving === null;
  const canResume = m.canManage && (m.status === "paused" || m.pausing !== null);
  const canEnd = memberCanEnd(m.status, m.canManage, m.leaving);
  const canKeep = m.canManage && m.leaving !== null && !ended;
  const canLink = m.canManage && due !== null && !ended && m.email !== null;
  const canPay = m.canManageMoney && due !== null && !ended && !due.paying;

  return (
    <View style={styles.body} testID="venue-member-detail">
      <PickerSheetHead title={m.memberName} onClose={onClose} plain={plainHead} testID="venue-member-head" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.pills}>
          <Pill variant={st.variant}>{st.label}</Pill>
          {m.inToday && !ended ? <Pill variant="ok">In today</Pill> : null}
          {m.signedIn ? <Pill variant="muted">Has a Mingla account</Pill> : null}
        </View>
        {m.status === "lapsed" ? (
          <Banner tone="danger" title="Not paid: their pass doesn't open the door" body="It starts again as soon as they pay. Send the link, or mark it paid if they paid you." testID="venue-member-lapsed" />
        ) : m.status === "payment_due" || m.status === "grace" ? (
          <Banner tone="warning" title={`This ${m.plan.period} isn't paid yet`} body={`They can still check in until ${day(due?.graceEndsAt)}.`} testID="venue-member-due" />
        ) : m.status === "requested" ? (
          <Banner tone="info" title="Membership request" body={`${m.memberName} has not paid. Approve the request first, then they have 3 days to pay their first ${m.plan.period}.`} />
        ) : m.status === "declined" ? (
          <Banner tone="info" title="Request declined" body="No payment was taken and this person is not a member." />
        ) : m.leaving !== null && !ended ? (
          <Banner tone="info" title={`Leaving ${day(m.leaving.endsAt)}`} body={m.leaving.by === "member" ? "They asked to leave. Their pass works until then." : "The venue ended this membership from that day."} />
        ) : null}
        {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

        <View style={styles.facts} testID="venue-member-facts">
          {facts.map((f) => (
            <View key={f.key} style={styles.factRow}>
              <Text style={styles.factLabel}>{f.label}</Text>
              <Text style={styles.factValue}>{f.value}</Text>
            </View>
          ))}
        </View>

        {m.status === "requested" && m.canManage ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Request</Text>
            <Button label="Review request" variant="primary" size="md" onPress={() => setMode("request")} testID="venue-member-review-request" />
          </View>
        ) : null}

        {m.canManage && memberCanAssignDesk(m.status) && m.plan.deskSpaces.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Desk</Text>
            {m.deskBookedFrom !== null ? <Banner tone="warning" title={`${m.assignedSpace?.name ?? "This desk"} is booked from ${day(m.deskBookedFrom)}`} body="Pick another desk before then." /> : null}
            <ActionLine
              icon="location"
              label={m.assignedSpace === null ? "Assign a desk" : "Change desk"}
              detail={m.assignedSpace?.name ?? "Pick a free desk from this plan"}
              onPress={() => setMode("desk")}
              testID="venue-member-desk"
            />
          </View>
        ) : null}

        {!requestState ? (
          <View style={styles.section} testID="venue-member-billing">
            <Text style={styles.sectionLabel}>{due !== null ? `${m.plan.period === "year" ? "Year" : "Month"} from ${day(due.periodStart)}` : "Billing"}</Text>
            <Timeline items={steps.map((s) => ({ key: s.key, title: s.title, meta: s.meta, state: s.state }))} />
            {due !== null ? (
              <Text style={styles.meta}>{`${money(due.amountMinor, due.currencyCode)} for the ${m.plan.period}, plus VAT if the venue adds it.`}</Text>
            ) : null}
            {due?.paying ? <Text style={styles.meta}>They opened the payment page a moment ago. Check back in a few minutes.</Text> : null}
            {canLink || canPay ? (
              <View style={styles.actionRow}>
                {canPay ? <Button label="Mark as paid" variant="secondary" size="md" leadingIcon="cash" onPress={() => { setError(null); setMode("pay"); }} testID="venue-member-mark-paid" /> : null}
                {canLink ? (
                  <Button
                    label="Send payment link"
                    variant="primary"
                    size="md"
                    leadingIcon="send"
                    loading={manage.isPending}
                    onPress={() => act({ action: "send_link" }, `Payment link sent to ${m.email ?? m.memberName}`)}
                    testID="venue-member-send-link"
                  />
                ) : null}
              </View>
            ) : due !== null && !ended && !m.canManageMoney ? (
              <Text style={styles.meta}>{`Only people who handle money for this venue can mark a ${m.plan.period} paid.`}</Text>
            ) : null}
          </View>
        ) : null}

        {canResume || canPause || canKeep || canEnd ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Membership</Text>
            {canResume ? (
              <ActionLine
                icon="play"
                label={m.status === "paused" ? "Resume" : "Don't pause"}
                detail={
                  m.status !== "paused"
                    ? `Pausing ${day(m.pausing?.from)}`
                    : m.activeUntil !== null && Date.parse(m.activeUntil) > Date.now()
                      ? `Paid until ${day(m.activeUntil)}`
                      : `They pay for a new ${m.plan.period} to start again`
                } onPress={() => act({ action: "resume" }, `${m.memberName} resumed`)} testID="venue-member-resume" />
            ) : null}
            {canPause ? <ActionLine icon="pause" label="Pause" detail={`Now, or when the paid ${m.plan.period} ends`} onPress={() => { setError(null); setMode("pause"); }} testID="venue-member-pause" /> : null}
            {canKeep ? (
              <ActionLine icon="check" label="Keep them on" detail={`Instead of ending ${day(m.leaving?.endsAt)}`} onPress={() => act({ action: "undo_cancel" }, `${m.memberName} stays on`)} testID="venue-member-keep" />
            ) : null}
            {canEnd ? <ActionLine icon="close" label="End membership" detail={`Now, or when the paid ${m.plan.period} ends`} danger onPress={() => { setError(null); setMode("end"); }} testID="venue-member-end" /> : null}
          </View>
        ) : null}

        {m.periods.length > 0 ? (
          <View style={styles.section} testID="venue-member-months">
            <Text style={styles.sectionLabel}>{m.plan.period === "year" ? "Years" : "Months"}</Text>
            {m.periods.map((p) => (
              <View key={p.periodId} style={styles.lineRow}>
                <View style={styles.grow}>
                  <Text style={styles.lineTitle}>{`${day(p.start)} – ${day(p.end)}`}</Text>
                  <Text style={styles.meta}>{periodWords(p, tz, yearly)}</Text>
                </View>
                <Text style={styles.amount}>{money(p.amountMinor, p.currencyCode)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {m.visits.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Visits</Text>
            {m.visits.slice(0, 8).map((v) => (
              <Text key={v.at} style={[styles.meta, v.undone ? styles.struck : null]}>
                {`${day(v.localDate)}${v.guests > 0 ? ` · with ${v.guests} ${v.guests === 1 ? "guest" : "guests"}` : ""}${v.undone ? " · undone" : ""}`}
              </Text>
            ))}
          </View>
        ) : null}

        {m.timeline.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>History</Text>
            <Timeline
              items={[...m.timeline].reverse().slice(0, 12).map((e, i) => ({ key: `${e.type}-${i}`, title: timelineWords(e, m.plan.period), meta: day(e.at), state: "done" as const }))}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ActionLine({ icon, label, detail, onPress, danger = false, testID }: { icon: IconName; label: string; detail: string | null; onPress: () => void; danger?: boolean; testID?: string }): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail !== null ? `${label}, ${detail}` : label}
      style={({ pressed }) => [styles.actionLine, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Icon name={icon} size={18} color={danger ? color.errorText : color.text2} />
      <View style={styles.grow}>
        <Text style={[styles.actionLabel, danger ? styles.danger : null]}>{label}</Text>
        {detail !== null ? <Text style={styles.meta}>{detail}</Text> : null}
      </View>
      <Icon name="chevR" size={16} color={color.text3} />
    </Pressable>
  );
}

function RequestDecisionForm({
  m,
  busy,
  error,
  onBack,
  onApprove,
  onDecline,
}: {
  m: VenueMemberDetail;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onApprove: () => void;
  onDecline: (reason: string) => void;
}): React.ReactElement {
  const [reason, setReason] = useState("");
  return (
    <View style={styles.form} testID="venue-member-request-form">
      <Text style={styles.meta}>{`Approve ${m.memberName} for ${m.plan.name}. We will email a link to pay their first ${m.plan.period}; it expires after 3 days.`}</Text>
      <Input value={reason} onChangeText={(value) => setReason(value.slice(0, 300))} placeholder="Reason if declining (optional)" accessibilityLabel="Decline reason" testID="venue-member-decline-reason" />
      {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.footerRow}>
        <Button label="Back" variant="ghost" size="md" onPress={onBack} />
        <Button label="Decline" variant="secondary" size="md" loading={busy} onPress={() => onDecline(reason.trim())} testID="venue-member-decline" />
        <Button label="Approve" variant="primary" size="md" loading={busy} onPress={onApprove} testID="venue-member-approve" />
      </View>
    </View>
  );
}

function DeskForm({
  m,
  busy,
  error,
  onBack,
  onSubmit,
  onUnassign,
}: {
  m: VenueMemberDetail;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (spaceId: string) => void;
  onUnassign: () => void;
}): React.ReactElement {
  const [spaceId, setSpaceId] = useState<string | null>(m.assignedSpace?.id ?? null);
  return (
    <View style={styles.form} testID="venue-member-desk-form">
      <Text style={styles.meta}>The desk stays held for this member while their membership is active or in its payment grace period.</Text>
      <SelectSheet
        label="Desk"
        value={spaceId}
        options={m.plan.deskSpaces.map((spaceOption) => ({ value: spaceOption.id, label: spaceOption.name }))}
        onChange={setSpaceId}
        placeholder="Pick a desk"
        testID="venue-member-desk-select"
      />
      {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.footerRow}>
        <Button label="Back" variant="ghost" size="md" onPress={onBack} />
        {m.assignedSpace !== null ? <Button label="Unassign" variant="secondary" size="md" loading={busy} onPress={onUnassign} testID="venue-member-desk-unassign" /> : null}
        <Button label="Assign desk" variant="primary" size="md" loading={busy} disabled={spaceId === null} onPress={() => { if (spaceId !== null) onSubmit(spaceId); }} testID="venue-member-desk-submit" />
      </View>
    </View>
  );
}

const METHODS: readonly { key: "cash" | "transfer" | "card_at_venue" | "other"; label: string }[] = [
  { key: "transfer", label: "Transfer" },
  { key: "cash", label: "Cash" },
  { key: "card_at_venue", label: "Card" },
  { key: "other", label: "Other" },
];

function PayForm({ m, busy, error, onBack, onSubmit }: { m: VenueMemberDetail; busy: boolean; error: string | null; onBack: () => void; onSubmit: (method: "cash" | "transfer" | "card_at_venue" | "other", note: string) => void }): React.ReactElement {
  const [method, setMethod] = useState<"cash" | "transfer" | "card_at_venue" | "other">("transfer");
  const [note, setNote] = useState("");
  const due = m.paymentDue;
  return (
    <View style={styles.form} testID="venue-member-pay-form">
      <Text style={styles.meta}>
        {due !== null
          ? `${m.memberName} paid you for the ${m.plan.period} from ${memberDay(due.periodStart, m.venue.timezone, m.plan.period === "year") ?? ""}: ${money(due.amountMinor, due.currencyCode)}. Their membership runs to ${memberDay(due.periodEnd, m.venue.timezone, m.plan.period === "year") ?? ""}.`
          : "Nothing is owed right now."}
      </Text>
      <Text style={styles.label}>How they paid</Text>
      <Segmented options={METHODS.map((x) => ({ key: x.key, label: x.label }))} value={method} onChange={setMethod} accessibilityLabel="How they paid" testID="venue-member-pay-method" />
      <Input value={note} onChangeText={(t) => setNote(t.slice(0, 200))} placeholder="Note (optional), e.g. transfer reference" accessibilityLabel="Note" testID="venue-member-pay-note" />
      {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.footerRow}>
        <Button label="Back" variant="ghost" size="md" onPress={onBack} />
        <Button label="Mark as paid" variant="primary" size="md" loading={busy} disabled={due === null} onPress={() => onSubmit(method, note.trim())} testID="venue-member-pay-submit" />
      </View>
    </View>
  );
}

function WhenForm({
  m,
  kind,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  m: VenueMemberDetail;
  kind: "pause" | "end";
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: (when: "now" | "period_end", reason: string) => void;
}): React.ReactElement {
  const hasPaidPeriod = m.activeUntil !== null && Date.parse(m.activeUntil) > Date.now();
  const [when, setWhen] = useState<"now" | "period_end">(hasPaidPeriod ? "period_end" : "now");
  const [reason, setReason] = useState("");
  const until = memberDay(m.activeUntil, m.venue.timezone, m.plan.period === "year");
  const needsReason = kind === "end";
  const reasonOk = !needsReason || reason.trim().length >= 3;
  const consequence =
    kind === "pause"
      ? when === "now"
        ? `Their pass stops working now and they get no payment emails. To start again they pay for a new ${m.plan.period}, or you resume them.`
        : `Their pass works until ${until ?? `the end of the paid ${m.plan.period}`}, then the membership pauses. No payment email goes out for the next ${m.plan.period}.`
      : when === "now"
        ? "Their pass stops working now. Nothing is refunded here: settle any refund with them directly."
        : `Their pass works until ${until ?? `the end of the paid ${m.plan.period}`}, then the membership ends. No more payment emails.`;
  return (
    <View style={styles.form} testID={`venue-member-${kind}-form`}>
      <Text style={styles.label}>When</Text>
      <Segmented
        options={[
          { key: "period_end", label: until !== null && hasPaidPeriod ? `On ${until}` : `End of ${m.plan.period}`, disabled: !hasPaidPeriod },
          { key: "now", label: "Now" },
        ]}
        value={when}
        onChange={setWhen}
        accessibilityLabel="When"
        testID={`venue-member-${kind}-when`}
      />
      <Input
        value={reason}
        onChangeText={(t) => setReason(t.slice(0, 300))}
        placeholder={needsReason ? "Why (the member doesn't see this)" : "Why (optional)"}
        accessibilityLabel="Reason"
        testID={`venue-member-${kind}-reason`}
      />
      <Banner tone={kind === "end" ? "warning" : "info"} title={consequence} />
      {error !== null ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.footerRow}>
        <Button label="Back" variant="ghost" size="md" onPress={onBack} />
        <Button
          label={kind === "pause" ? (when === "now" ? "Pause now" : `Pause at ${m.plan.period} end`) : when === "now" ? "End now" : `End at ${m.plan.period} end`}
          variant={kind === "end" ? "danger" : "primary"}
          size="md"
          loading={busy}
          disabled={!reasonOk}
          onPress={() => onSubmit(when, reason.trim())}
          testID={`venue-member-${kind}-submit`}
        />
      </View>
      {needsReason && !reasonOk ? <Text style={styles.meta}>Add a short reason to end it.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  scroll: { flex: 1 },
  content: { gap: space[3], paddingBottom: space[8] },
  title: { ...type.h2, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  label: { ...type.label, color: color.text2 },
  error: { ...type.small, color: color.errorText },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  pills: { flexDirection: "row", gap: space[2], flexWrap: "wrap" },
  facts: { gap: space[2] },
  factRow: { flexDirection: "row", gap: space[3], alignItems: "flex-start" },
  factLabel: { ...type.small, color: color.text2, width: 110, flexShrink: 0 },
  factValue: { ...type.small, color: color.text1, fontWeight: "600", flex: 1, minWidth: 0 },
  section: { gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.line },
  sectionLabel: { ...type.label, color: color.text3 },
  actionRow: { flexDirection: "row", gap: space[2], flexWrap: "wrap", alignItems: "flex-start" },
  actionLine: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 52, borderRadius: radius.sm, paddingHorizontal: space[1] },
  actionLabel: { ...type.row, color: color.text1 },
  danger: { color: color.errorText },
  pressed: { backgroundColor: color.fill.pressed },
  lineRow: { flexDirection: "row", gap: space[2], alignItems: "center", minHeight: 44 },
  lineTitle: { ...type.small, color: color.text1, fontWeight: "600" },
  amount: { ...type.small, color: color.text1, fontVariant: ["tabular-nums"] },
  struck: { textDecorationLine: "line-through" },
  form: { gap: space[3], paddingBottom: space[4] },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2], flexWrap: "wrap" },
});
