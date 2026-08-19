/**
 * #2305 — the identity-conflict review queue.
 *
 * THE ONE IDEA THE SCREEN RESTS ON (DESIGN §0): one side is a PERSON, the other
 * side is a TRANSACTION. The question is never "which of these two humans wins"
 * — it is "where do I file this ticket?". Nobody loses. That reframe is why the
 * transaction side deliberately carries NO avatar: it is not a person yet, and
 * inventing an initial-circle would fabricate a human who does not exist.
 *
 * No side-by-side comparison at any width. The matched value is printed THREE
 * times — once in the evidence band, once under the transaction, once under the
 * person — same string, same monospace face, same marker. Repetition is how a
 * human actually verifies a phone number; two adjacent columns is not. That
 * triple print is the comparison mechanism, and it is why no gutter is needed.
 *
 * NOTHING HERE MAY CLAIM A DECISION IS REVERSIBLE. `biz_merge_brand_people` and
 * `biz_reverse_brand_person_merge` are both service_role-only with no Split UI,
 * and the separations table grants no DELETE. Both outcomes are undoable in the
 * database and undoable by NOBODY from the operator's seat. The consequence line
 * says "can't be undone here", which is precisely true.
 */
import React from "react";
import {
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import {
  accent,
  androidOpaque,
  durations,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { PeopleServiceError } from "../../services/peopleService";
import type {
  BrandPersonConflict,
  BrandPersonConflictCandidate,
  BrandPersonConflictSourceKind,
  ConflictResolution,
} from "../../types/people";
import { Avatar } from "../ui/Avatar";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EmptyState } from "../ui/EmptyState";
import { Icon, type IconName } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { Skeleton } from "../ui/Skeleton";
import { Spinner } from "../ui/Spinner";
import type { ConflictQueryKind } from "../../hooks/marketing/useBrandPersonConflicts";

/* --------------------------------------------------------------- control --- */

/**
 * The sheet owns its controls rather than using `Button variant="secondary"`.
 *
 * WHY, and it is not a preference: `glass.border.profileElevated` — the border
 * `Button`'s secondary variant paints — is **1.45:1**, below WCAG 2.2 SC 1.4.11's
 * 3:1 for a control boundary. The DESIGN specifies overriding it locally with
 * `glass.border.control` (3.09:1, and its docblock says it exists for exactly
 * this). That override CANNOT work through `Button`: `Button` spreads its `style`
 * prop onto the outer `Pressable` (Button.tsx:311), while the border lives on the
 * inner `Animated.View` that carries `styles.container` — so a `borderColor`
 * passed in lands on an element with no border width and is a silent no-op.
 *
 * The DESIGN's §3.4 fallback fired ("if Button does not merge style after its
 * variant tokens, that is a blocker to raise, not to work around"), and the
 * orchestrator's DESIGN REVIEW accepted a LOCAL override for this screen with the
 * system-wide fix filed separately. This control IS that local override: 44pt,
 * `buttonMd`, full width, a 3.09:1 boundary, and its own web focus ring.
 *
 * Never a nested `Pressable` — nesting flattens the a11y subtree, so the two
 * outcome controls and the candidate radios are always SIBLINGS.
 */
function OutcomeControl(
  props:
    | {
        kind: "button";
        label: string;
        loading: boolean;
        disabled: boolean;
        onPress: () => void;
        accessibilityLabel: string;
      }
    | {
        kind: "radio";
        selected: boolean;
        onPress: () => void;
        accessibilityLabel: string;
        style: StyleProp<ViewStyle>;
        children: React.ReactNode;
      },
): React.ReactElement {
  if (props.kind === "radio") {
    return (
      <Pressable
        onPress={props.onPress}
        accessibilityRole="radio"
        accessibilityState={{ selected: props.selected }}
        accessibilityLabel={props.accessibilityLabel}
        style={({ pressed, focused }: PressableStateCallbackType & { focused?: boolean }) => [
          props.style,
          pressed ? s.pressed : null,
          focused === true && Platform.OS === "web" ? s.focusRing : null,
        ]}
      >
        {props.children}
      </Pressable>
    );
  }
  const interactive = !props.disabled && !props.loading;
  return (
    <Pressable
      onPress={interactive ? props.onPress : undefined}
      disabled={props.disabled || props.loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled, busy: props.loading }}
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed, focused }: PressableStateCallbackType & { focused?: boolean }) => [
        s.control,
        props.disabled ? s.controlDisabled : null,
        pressed ? s.pressed : null,
        focused === true && Platform.OS === "web" ? s.focusRing : null,
      ]}
    >
      <View style={s.controlContent}>
        {props.loading ? <Spinner size={24} color={text.primary} /> : null}
        <Text style={[s.controlLabel, props.loading ? s.controlLabelDim : null]} numberOfLines={1}>
          {props.label}
        </Text>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ copy --- */

/** Plain language, never the raw `source_kind`. */
const SOURCE_EYEBROW: Record<BrandPersonConflictSourceKind, string> = {
  order: "THIS ORDER",
  ticket_holder: "THIS TICKET",
  event_rsvp: "THIS RSVP",
  rsvp_plus_one: "THIS RSVP",
  reservation: "THIS TABLE BOOKING",
  stay_reservation: "THIS ROOM BOOKING",
  import: "THIS IMPORTED ROW",
  manual: "ADDED BY HAND",
};
/** All already in the Icon roster — zero marginal eager bundle bytes. */
const SOURCE_GLYPH: Record<BrandPersonConflictSourceKind, IconName> = {
  order: "receipt",
  ticket_holder: "ticket",
  event_rsvp: "calendar",
  rsvp_plus_one: "calendar",
  reservation: "calendar",
  stay_reservation: "home",
  import: "upload",
  manual: "user",
};
/** Singular noun for the button copy — "file this ticket under…". */
const SOURCE_NOUN: Record<BrandPersonConflictSourceKind, string> = {
  order: "order",
  ticket_holder: "ticket",
  event_rsvp: "RSVP",
  rsvp_plus_one: "RSVP",
  reservation: "table booking",
  stay_reservation: "room booking",
  import: "imported row",
  manual: "entry",
};

const CODE_COPY: Record<string, string> = {
  people_conflict_already_resolved: "Someone else already reviewed this one.",
  people_conflict_source_missing: "That order is no longer here.",
  people_conflict_user_collision:
    "Another person in your book is already linked to this customer's Mingla account.",
  people_conflict_candidate_invalid: "That record has changed. Reopen this list and try again.",
  people_conflict_not_found: "Couldn't file this one. Reopen this list and try again.",
  people_resolution_invalid: "Couldn't file this one. Reopen this list and try again.",
  people_conflict_subject_unavailable:
    "The details behind this one weren't kept, so it can't be filed here.",
  people_forbidden: "You can no longer file these. Ask a brand admin.",
};
function errorCopy(error: unknown): string {
  if (error instanceof PeopleServiceError && !error.retryable && CODE_COPY[error.code] !== undefined) {
    return CODE_COPY[error.code] as string;
  }
  return "Couldn't file this one. Check your connection and try again.";
}
/** The card self-removes for codes where the row is already gone server-side. */
function isStaleCode(error: unknown): boolean {
  return (
    error instanceof PeopleServiceError &&
    (error.code === "people_conflict_already_resolved" ||
      error.code === "people_conflict_source_missing")
  );
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function matchedLabel(matchedOn: readonly string[]): string {
  const email = matchedOn.includes("email");
  const phone = matchedOn.includes("phone");
  if (email && phone) return "MATCHED ON EMAIL AND PHONE";
  if (email) return "MATCHED ON EMAIL";
  if (phone) return "MATCHED ON PHONE";
  return "";
}

/* ------------------------------------------------------------ platform --- */
// Every Platform.select supplies COMPLETE objects on both branches — never an
// override that sets a key to `undefined`, because RN-web keeps the base atom in
// the DOM. Android never receives translucent glass here
// (ANDROID_GLASS_USES_OPAQUE_FALLBACK): every Android branch is an opaque
// composite from `androidOpaque`, and there is no BlurView on this surface at
// all (nesting one inside the Sheet's BlurView double-blurs and muddies text).

const cardSurface = Platform.select({
  android: { backgroundColor: androidOpaque.rowFill, borderColor: androidOpaque.rowBorder },
  default: { backgroundColor: glass.tint.profileBase, borderColor: glass.border.profileBase },
});
const warningFill = Platform.select({
  android: { backgroundColor: androidOpaque.warningFill },
  default: { backgroundColor: semantic.warningTint },
});
const successFill = Platform.select({
  android: { backgroundColor: androidOpaque.successFill },
  default: { backgroundColor: semantic.successTint },
});
const neutralFill = Platform.select({
  android: { backgroundColor: androidOpaque.rowBorder },
  default: { backgroundColor: glass.tint.profileElevated },
});
const selectedFill = Platform.select({
  android: { backgroundColor: androidOpaque.accentFill },
  default: { backgroundColor: accent.tint },
});

/* --------------------------------------------------------------- pieces --- */

/**
 * A contact value. `monoMd` on every value is load-bearing: phone numbers and
 * emails are verified character-by-character and a proportional face makes that
 * impossible. Values NEVER truncate — a truncated phone number is a wrong phone
 * number — so they wrap instead, with no `numberOfLines`.
 */
function ContactLine({ value, matched }: { value: string; matched: boolean }): React.ReactElement {
  return (
    <View style={s.contactRow}>
      <Text style={[s.contactValue, matched ? s.contactMatched : s.contactOther]}>{value}</Text>
      {matched ? (
        <View style={s.matchedMarker}>
          <Icon name="link" size={12} color={semantic.warning} />
          <Text style={s.matchedMarkerText}>matched</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * An absence is a statement ABOUT the data, never a value — so it is italic
 * `bodySm` and never monospace. One typographic rule carries the whole
 * no-fabricated-data requirement: if it isn't monospace, it isn't a value.
 * Absence is COMPARATIVE — rendered only when this side lacks a channel the
 * other side has, because otherwise it carries no decision value.
 */
function AbsenceLine({ channel }: { channel: "email" | "phone" }): React.ReactElement {
  return <Text style={s.absence}>{`No ${channel} on file`}</Text>;
}

function RecordBlock({
  eyebrow,
  glyph,
  age,
  name,
  avatarUrl,
  showAvatar,
  contacts,
  absences,
  matchedValues,
  accessibilityLabel,
}: {
  eyebrow: string;
  glyph: IconName;
  age: string | null;
  name: string;
  avatarUrl?: string | null;
  showAvatar: boolean;
  contacts: { value: string }[];
  absences: ("email" | "phone")[];
  matchedValues: string[];
  accessibilityLabel: string;
}): React.ReactElement {
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={s.record}>
      <View style={s.eyebrowRow}>
        <View style={s.eyebrowLeft}>
          <Icon name={glyph} size={16} color={text.tertiary} />
          <Text style={s.eyebrow}>{eyebrow}</Text>
        </View>
        {age !== null ? <Text style={s.age}>{age}</Text> : null}
      </View>
      <View style={s.nameRow}>
        {showAvatar ? (
          <Avatar name={name} size="row" photo={avatarUrl ?? undefined} accessibilityLabel=" " />
        ) : null}
        {/* bodyLg @700, NOT h3: the names are the two things in disagreement and
            must dominate, but the sheet already owns one h3 and three would
            flatten the hierarchy. These are values, so no `header` role. */}
        <Text style={s.name}>{name}</Text>
      </View>
      {contacts.map((c) => (
        <ContactLine key={c.value} value={c.value} matched={matchedValues.includes(c.value)} />
      ))}
      {absences.map((a) => (
        <AbsenceLine key={a} channel={a} />
      ))}
    </View>
  );
}

function CandidateRow({
  candidate,
  selected,
  selectable,
  matchedValues,
  onSelect,
  accessibilityLabel,
}: {
  candidate: BrandPersonConflictCandidate;
  selected: boolean;
  selectable: boolean;
  matchedValues: string[];
  onSelect: () => void;
  accessibilityLabel: string;
}): React.ReactElement {
  const body = (
    <>
      <View style={s.nameRow}>
        <Avatar
          name={candidate.displayName}
          size="row"
          photo={candidate.avatarUrl ?? undefined}
          accessibilityLabel=" "
        />
        <Text style={s.name}>{candidate.displayName}</Text>
        {/* The accent lives in the border and the glyph, NEVER in the label:
            accent.warm on the selected fill is 3.55:1 and fails at body weight.
            OptionCard's already-audited rule, reused verbatim. */}
        {selected ? (
          <View style={s.checkSlot}>
            <Icon name="check" size={14} color={accent.warm} />
          </View>
        ) : null}
      </View>
      {candidate.contacts.map((c) => (
        <ContactLine key={`${c.channel}:${c.value}`} value={c.value} matched={matchedValues.includes(c.value)} />
      ))}
    </>
  );
  if (!selectable) {
    // Rank 20-49: static rows, not radios. No selection affordance at all.
    return (
      <View accessible accessibilityRole="text" accessibilityLabel={accessibilityLabel} style={s.candidateIdle}>
        {body}
      </View>
    );
  }
  return (
    <OutcomeControl
      kind="radio"
      selected={selected}
      onPress={onSelect}
      accessibilityLabel={accessibilityLabel}
      style={[s.candidateBase, selected ? [s.candidateSelected, selectedFill] : s.candidateIdleBorder]}
    >
      {body}
    </OutcomeControl>
  );
}

/* ----------------------------------------------------------------- card --- */

type CardState =
  | { phase: "idle" }
  | { phase: "submitting"; resolution: ConflictResolution }
  | { phase: "done"; resolution: ConflictResolution; personName: string; mergedCount: number }
  | { phase: "error"; error: unknown };

function ConflictCard({
  conflict,
  canResolve,
  online,
  state,
  selectedCandidateId,
  onSelectCandidate,
  onResolve,
}: {
  conflict: BrandPersonConflict;
  canResolve: boolean;
  online: boolean;
  state: CardState;
  selectedCandidateId: string | null;
  onSelectCandidate: (personId: string) => void;
  onResolve: (resolution: ConflictResolution, winnerPersonId: string | null) => void;
}): React.ReactElement {
  const kinds = conflict.sourceKinds;
  const leadKind: BrandPersonConflictSourceKind = kinds[0] ?? "order";
  const noun = SOURCE_NOUN[leadKind];
  const incomingName = conflict.incoming.displayName;
  const candidateCount = conflict.candidates.length;
  const nWay = candidateCount >= 2;

  const incomingValues = [conflict.incoming.email, conflict.incoming.phone].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  // matchedOn is computed by the RPC against real contact rows, never guessed.
  const matchedValues = incomingValues.filter((v) => {
    const isEmail = v === conflict.incoming.email;
    return conflict.matchedOn.includes(isEmail ? "email" : "phone");
  });

  const bandLabel = matchedLabel(conflict.matchedOn);
  const emptyCandidates = candidateCount === 0;

  /* ---- Zone 1: the evidence band. Not a chip — the card's header, full-bleed.
     A chip is metadata; this value is the entire evidence base for a decision
     about a real customer. Warning family, never error: nothing failed, and red
     would push the operator toward "Different people" as a safe-looking exit. */
  const band = ((): React.ReactElement => {
    if (state.phase === "done") {
      const receipt =
        state.resolution === "separate"
          ? "Added as a new person"
          : state.mergedCount > 0
            ? `Merged into ${state.personName}`
            : `Filed under ${state.personName}`;
      return (
        <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" style={[s.band, successFill]}>
          <View style={s.bandRow}>
            <Icon name="check" size={16} color={semantic.success} />
            <Text style={s.receiptText}>{receipt}</Text>
          </View>
        </View>
      );
    }
    if (emptyCandidates) {
      // Not a conflict of identity — an UNFILED record. The card must stop
      // pretending to be a comparison. A "MATCHED ON —" band would be a lie.
      return (
        <View accessible accessibilityRole="text" style={[s.band, neutralFill]}>
          <View style={s.bandRow}>
            <Icon name="inbox" size={16} color={text.secondary} />
            <Text style={s.bandLabelNeutral}>NOTHING MATCHED</Text>
          </View>
          <Text style={s.bandSub}>No existing record shares this email or phone.</Text>
        </View>
      );
    }
    if (conflict.matchedOn.length === 0) {
      // The matching contact method was retired after the conflict was filed.
      // Never render an empty band; never invent a channel.
      return (
        <View accessible accessibilityRole="text" style={[s.band, neutralFill]}>
          <View style={s.bandRow}>
            <Icon name="link" size={16} color={text.tertiary} />
            <Text style={s.bandLabelNeutral}>THE SHARED DETAIL IS GONE</Text>
          </View>
          <Text style={s.bandSub}>The email or phone that matched has since been removed.</Text>
        </View>
      );
    }
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${bandLabel.toLowerCase()}: ${matchedValues.join(", ")}`}
        style={[s.band, s.bandWarn, warningFill]}
      >
        <View style={s.bandRow}>
          <Icon name="link" size={16} color={semantic.warning} />
          <Text style={s.bandLabel}>{bandLabel}</Text>
        </View>
        {/* Both channels matched => both values stack. Materially stronger
            evidence must LOOK stronger; the design refuses to flatten it. */}
        {matchedValues.map((v) => (
          <Text key={v} style={s.bandValue}>
            {v}
          </Text>
        ))}
      </View>
    );
  })();

  const incomingAbsences: ("email" | "phone")[] = [];
  const candidateHasEmail = conflict.candidates.some((c) => c.contacts.some((x) => x.channel === "email"));
  const candidateHasPhone = conflict.candidates.some((c) => c.contacts.some((x) => x.channel === "phone"));
  if (conflict.incoming.email === null && candidateHasEmail) incomingAbsences.push("email");
  if (conflict.incoming.phone === null && candidateHasPhone) incomingAbsences.push("phone");

  const age = ((): string | null => {
    const days = Math.floor((Date.now() - new Date(conflict.createdAt).getTime()) / 86_400_000);
    if (!Number.isFinite(days) || days < 1) return null;
    return `${days} ${plural(days, "day", "days")} ago`;
  })();

  const showOutcomes = canResolve && state.phase !== "done";
  const submitting = state.phase === "submitting";

  return (
    <View style={[s.card, cardSurface]} testID={`people-conflict-card-${conflict.conflictIds[0]}`}>
      {band}

      {/* Zone 2 — the transaction. No avatar: it is not a person yet. */}
      {conflict.detailsRetained && incomingName !== null ? (
        <RecordBlock
          eyebrow={
            kinds.length > 1
              ? `${SOURCE_EYEBROW[leadKind]} +${kinds.length - 1}`
              : SOURCE_EYEBROW[leadKind]
          }
          glyph={SOURCE_GLYPH[leadKind]}
          age={age}
          name={incomingName}
          showAvatar={false}
          contacts={incomingValues.map((v) => ({ value: v }))}
          absences={incomingAbsences}
          matchedValues={matchedValues}
          accessibilityLabel={`${SOURCE_EYEBROW[leadKind].toLowerCase()}: ${incomingName}. ${incomingValues
            .map((v) => `${v}${matchedValues.includes(v) ? ", matched" : ""}`)
            .join(". ")}`}
        />
      ) : (
        <View accessible accessibilityRole="text" style={s.record}>
          <View style={s.eyebrowRow}>
            <View style={s.eyebrowLeft}>
              <Icon name="user" size={16} color={text.tertiary} />
              <Text style={s.eyebrow}>ADDED BY HAND</Text>
            </View>
            {age !== null ? <Text style={s.age}>{age}</Text> : null}
          </View>
          <Text style={s.absence}>
            The details behind this one weren&apos;t kept, so there is nothing to compare.
          </Text>
        </View>
      )}

      {/* Zone 3 — the seam. Absent when there is no second side to seam to. */}
      {!emptyCandidates ? (
        <View style={s.seam}>
          <View style={s.seamRule} />
          <Text style={s.seamLabel}>{nWay ? "WHICH ONE IS THIS?" : "SAME PERSON?"}</Text>
          <View style={s.seamRule} />
        </View>
      ) : null}

      {/* Zone 4 — the person(s) already in the book. */}
      {!nWay && conflict.candidates[0] !== undefined ? (
        <RecordBlock
          eyebrow="IN YOUR BOOK"
          glyph="user"
          age={null}
          name={conflict.candidates[0].displayName}
          avatarUrl={conflict.candidates[0].avatarUrl}
          showAvatar
          contacts={conflict.candidates[0].contacts.map((c) => ({ value: c.value }))}
          absences={((): ("email" | "phone")[] => {
            const out: ("email" | "phone")[] = [];
            const c = conflict.candidates[0] as BrandPersonConflictCandidate;
            if (!c.contacts.some((x) => x.channel === "email") && conflict.incoming.email !== null) out.push("email");
            if (!c.contacts.some((x) => x.channel === "phone") && conflict.incoming.phone !== null) out.push("phone");
            return out;
          })()}
          matchedValues={matchedValues}
          accessibilityLabel={`In your book: ${conflict.candidates[0].displayName}. ${conflict.candidates[0].contacts
            .map((c) => `${c.value}${matchedValues.includes(c.value) ? ", matched" : ""}`)
            .join(". ")}`}
        />
      ) : nWay ? (
        <View style={s.candidateList}>
          {conflict.candidates.map((c) => (
            <CandidateRow
              key={c.personId}
              candidate={c}
              selected={selectedCandidateId === c.personId}
              selectable={showOutcomes && !submitting}
              matchedValues={matchedValues}
              onSelect={() => onSelectCandidate(c.personId)}
              accessibilityLabel={`In your book: ${c.displayName}. ${c.contacts
                .map((x) => `${x.value}${matchedValues.includes(x.value) ? ", matched" : ""}`)
                .join(". ")}`}
            />
          ))}
        </View>
      ) : null}

      {/* Zone 5 — the consequence line. NOT optional (orchestrator DESIGN REVIEW
          decision 2): choosing one candidate destroys the other N-1 person
          records, and a UI that shows three names and a "Same person" button
          without saying so obtains uninformed consent. */}
      {nWay && showOutcomes ? (
        <View style={s.consequence}>
          <Icon name="shield" size={16} color={semantic.warning} />
          <Text style={s.consequenceText}>
            {`Choosing one merges all ${candidateCount} records into it. This can't be undone here.`}
          </Text>
        </View>
      ) : null}

      {/* Per-card error, above the outcome row. The COPY is text.primary at
          14.90:1, never semantic.error red (4.28:1 — below AA for 14px). The red
          lives in the glyph, which only needs 3:1. An error message is the thing
          you most need to be able to read. */}
      {state.phase === "error" ? (
        <View accessibilityLiveRegion="assertive" style={s.cardError}>
          <Icon name="x" size={16} color={semantic.error} />
          <Text style={s.cardErrorText}>{errorCopy(state.error)}</Text>
        </View>
      ) : null}

      {/* Zone 6 — the decision. Equal weight, stacked full-width at EVERY width.
          Side by side in LTR the left control reads as primary, and that is a
          bias this screen refuses to introduce. Neither is `primary`: the card
          is a question, not a task, and an orange button would be an
          instruction. Order: "Same person" first, because the card exists
          BECAUSE a shared address was found — "same" is the hypothesis under
          test. ABSENT (not disabled) at rank 20-49: a permanent gate rendered
          as a greyed control is a dead control. */}
      {showOutcomes ? (
        <View style={s.outcomes}>
          {emptyCandidates ? (
            <>
              <Text style={s.outcomeHint}>
                This row was held back during an import. Adding it creates a new person.
              </Text>
              <OutcomeControl
                kind="button"
                label="Add to your book"
                loading={submitting}
                disabled={!online || submitting}
                onPress={() => onResolve("separate", null)}
                accessibilityLabel={`Add ${incomingName ?? "this row"} to your book`}
              />
            </>
          ) : (
            <>
              <OutcomeControl
                kind="button"
                label="Same person"
                loading={submitting && state.phase === "submitting" && state.resolution === "merge"}
                disabled={
                  !online ||
                  submitting ||
                  !conflict.detailsRetained ||
                  (nWay && selectedCandidateId === null)
                }
                onPress={() =>
                  onResolve("merge", nWay ? selectedCandidateId : (conflict.candidates[0]?.personId ?? null))
                }
                accessibilityLabel={
                  nWay && selectedCandidateId === null
                    ? "Same person — pick a record above first"
                    : `Same person — file this ${noun} under ${
                        (nWay
                          ? conflict.candidates.find((c) => c.personId === selectedCandidateId)?.displayName
                          : conflict.candidates[0]?.displayName) ?? "this record"
                      }`
                }
              />
              <OutcomeControl
                kind="button"
                label={nWay ? "None of these" : "Different people"}
                loading={submitting && state.phase === "submitting" && state.resolution === "separate"}
                disabled={!online || submitting || !conflict.detailsRetained}
                onPress={() => onResolve("separate", null)}
                accessibilityLabel={`Different people — add ${incomingName ?? "this entry"} as a new person`}
              />
            </>
          )}
          {!online ? <Text style={s.outcomeHint}>You&apos;re offline. Reconnect to resolve.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- sheet --- */

export interface ConflictReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  kind: ConflictQueryKind;
  rows: BrandPersonConflict[];
  openCount: number;
  online: boolean;
  onRetry: () => void;
  onResolve: (input: {
    conflictIds: string[];
    resolution: ConflictResolution;
    winnerPersonId: string | null;
  }) => Promise<{ personId: string | null; mergedPersonIds: string[] }>;
  onResolvedCountChange?: (count: number) => void;
}

export function ConflictReviewSheet({
  visible,
  onClose,
  kind,
  rows,
  openCount,
  online,
  onRetry,
  onResolve,
  onResolvedCountChange,
}: ConflictReviewSheetProps): React.ReactElement {
  const [cardState, setCardState] = React.useState<Record<string, CardState>>({});
  const [selected, setSelected] = React.useState<Record<string, string | null>>({});
  const [dismissed, setDismissed] = React.useState<Record<string, true>>({});
  const [resolvedThisSession, setResolvedThisSession] = React.useState(0);
  const [confirm, setConfirm] = React.useState<
    { conflict: BrandPersonConflict; winnerPersonId: string } | null
  >(null);

  React.useEffect(() => {
    if (!visible) {
      setCardState({});
      setSelected({});
      setDismissed({});
      setResolvedThisSession(0);
      setConfirm(null);
    }
  }, [visible]);

  React.useEffect(() => {
    onResolvedCountChange?.(resolvedThisSession);
  }, [onResolvedCountChange, resolvedThisSession]);

  const canResolveAll = rows.length > 0 && rows.every((r) => r.canResolve);

  const commit = React.useCallback(
    async (conflict: BrandPersonConflict, resolution: ConflictResolution, winnerPersonId: string | null) => {
      const key = conflict.conflictIds[0] as string;
      setCardState((prev) => ({ ...prev, [key]: { phase: "submitting", resolution } }));
      try {
        const result = await onResolve({
          conflictIds: conflict.conflictIds,
          resolution,
          winnerPersonId,
        });
        const personName =
          resolution === "merge"
            ? (conflict.candidates.find((c) => c.personId === winnerPersonId)?.displayName ??
              conflict.candidates[0]?.displayName ??
              "this record")
            : (conflict.incoming.displayName ?? "a new person");
        setCardState((prev) => ({
          ...prev,
          [key]: {
            phase: "done",
            resolution,
            personName,
            mergedCount: result.mergedPersonIds.length,
          },
        }));
        setResolvedThisSession((n) => n + 1);
        // The receipt HOLDS 700ms and names what happened to whom. This is the
        // only moment the operator can catch their own mistake, so the hold is
        // information, not decoration — it survives reduced motion unchanged.
        setTimeout(() => setDismissed((prev) => ({ ...prev, [key]: true })), 700 + durations.exit);
      } catch (error) {
        setCardState((prev) => ({ ...prev, [key]: { phase: "error", error } }));
        if (isStaleCode(error)) {
          setTimeout(() => setDismissed((prev) => ({ ...prev, [key]: true })), 1200);
          onRetry();
        }
      }
    },
    [onResolve, onRetry],
  );

  const requestResolve = React.useCallback(
    (conflict: BrandPersonConflict, resolution: ConflictResolution, winnerPersonId: string | null) => {
      // Friction proportional to consequence: merge confirms, separate does not.
      // "Different people" has no second party to misname and builds its record
      // from data already on screen; a generic "are you sure?" with no new
      // information is the kind of dialog people learn to dismiss — which would
      // degrade the merge confirm too.
      if (resolution === "merge" && winnerPersonId !== null) {
        setConfirm({ conflict, winnerPersonId });
        return;
      }
      void commit(conflict, resolution, winnerPersonId);
    },
    [commit],
  );

  const visibleRows = rows.filter((r) => dismissed[r.conflictIds[0] as string] === undefined);
  const remaining = Math.max(openCount - resolvedThisSession, 0);

  const body = ((): React.ReactElement => {
    if (kind === "loading" || kind === "authLoading" || kind === "roleLoading") {
      return (
        <View accessibilityLiveRegion="polite" style={s.list}>
          {[0, 1].map((i) => (
            <View key={i} style={[s.card, cardSurface, s.skeletonCard]}>
              <Skeleton width="100%" height={40} />
              <Skeleton width="60%" height={20} />
              <Skeleton width="80%" height={16} />
              <Skeleton width="100%" height={44} />
            </View>
          ))}
        </View>
      );
    }
    if (kind === "offlineEmpty") {
      return <EmptyState title="You’re offline." description="Connect to load the review list." />;
    }
    if (kind === "error") {
      return (
        <EmptyState
          title="Couldn’t load the review list."
          description="Check your connection and try again."
          cta={{ label: "Try again", onPress: () => onRetry(), variant: "secondary" }}
        />
      );
    }
    if (visibleRows.length === 0) {
      // Two empties, two truths. Congratulating someone for work they did not do
      // is the kind of small dishonesty that makes a product feel fake.
      return resolvedThisSession > 0 ? (
        <View style={s.earned}>
          <Icon name="check" size={48} color={semantic.success} />
          <EmptyState title="Everyone’s in the book." description="Nothing left to review." />
        </View>
      ) : (
        <EmptyState title="Nothing left to review." description="Someone else has filed these." />
      );
    }
    return (
      <View style={s.list}>
        {kind === "offlineStale" ? (
          <View style={s.staleBand}>
            <Text style={s.staleText}>You’re offline — showing what we last loaded.</Text>
          </View>
        ) : null}
        {kind === "refreshing" ? <Text style={s.status}>Updating…</Text> : null}
        {kind === "staleError" ? (
          <Text style={s.status}>Couldn’t update — showing what we last loaded.</Text>
        ) : null}
        {visibleRows.map((conflict) => {
          const key = conflict.conflictIds[0] as string;
          return (
            <ConflictCard
              key={key}
              conflict={conflict}
              canResolve={conflict.canResolve}
              online={online}
              state={cardState[key] ?? { phase: "idle" }}
              selectedCandidateId={selected[key] ?? null}
              onSelectCandidate={(personId) => setSelected((prev) => ({ ...prev, [key]: personId }))}
              onResolve={(resolution, winnerPersonId) =>
                requestResolve(conflict, resolution, winnerPersonId)
              }
            />
          );
        })}
      </View>
    );
  })();

  const confirmCopy = ((): { title: string; description: string } => {
    if (confirm === null) return { title: "", description: "" };
    const winner = confirm.conflict.candidates.find((c) => c.personId === confirm.winnerPersonId);
    const winnerName = winner?.displayName ?? "this record";
    const others = confirm.conflict.candidates.filter((c) => c.personId !== confirm.winnerPersonId);
    const noun = SOURCE_NOUN[confirm.conflict.sourceKinds[0] ?? "order"];
    const details = [confirm.conflict.incoming.email, confirm.conflict.incoming.phone]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(" and ");
    if (others.length > 0) {
      // The confirm names EVERY record being collapsed. Mandatory in the N-way
      // case — an operator who thinks they are choosing whose order this is is
      // in fact ordering the destruction of N-1 person records.
      return {
        title: `Merge ${confirm.conflict.candidates.length} records into ${winnerName}?`,
        description: `${others
          .map((o) => o.displayName)
          .join(" and ")} ${others.length === 1 ? "is" : "are"} folded into this record, along with this ${noun}. Their emails and phones move too.`,
      };
    }
    return {
      title: `File this ${noun} under ${winnerName}?`,
      description:
        details.length > 0
          ? `${details} become part of their record, and your brand can export them.`
          : `This ${noun} becomes part of their record.`,
    };
  })();

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="full" testID="people-conflict-sheet">
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={s.title}>
          Waiting to be added
        </Text>
        <Text style={s.subtitle}>
          {canResolveAll
            ? "Mingla couldn’t tell which record these belong to. You decide."
            : "Mingla couldn’t tell which record these belong to. A brand admin can file them."}
        </Text>
        {remaining > 0 ? (
          <Text accessibilityLiveRegion="polite" style={s.count}>
            {`${remaining} to review`}
          </Text>
        ) : null}
        {body}
      </ScrollView>
      {/* Sub-sheets render INSIDE the parent sheet's tree, never as siblings. */}
      <ConfirmDialog
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm;
          setConfirm(null);
          if (pending !== null) void commit(pending.conflict, "merge", pending.winnerPersonId);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        variant="simple"
        cancelLabel="Cancel"
        confirmLabel={
          confirm !== null && confirm.conflict.candidates.length > 1 ? "Yes, merge" : "Yes, same person"
        }
      />
    </Sheet>
  );
}

const s = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.xs },
  title: { ...typography.h3, color: text.primary },
  subtitle: { ...typography.bodySm, color: text.secondary },
  count: { ...typography.caption, color: text.tertiary },
  list: { gap: spacing.lg, paddingTop: spacing.md },
  status: { ...typography.bodySm, color: text.tertiary },
  staleBand: {
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  staleText: { ...typography.bodySm, color: text.secondary },
  earned: { alignItems: "center", gap: spacing.sm, paddingTop: spacing.xl },

  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  skeletonCard: { padding: spacing.md, gap: spacing.sm },

  band: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
    gap: spacing.xs,
  },
  bandWarn: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(245, 158, 11, 0.45)",
  },
  bandRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  bandLabel: { ...typography.labelCap, color: semantic.warning, flexShrink: 1 },
  bandLabelNeutral: { ...typography.labelCap, color: text.secondary, flexShrink: 1 },
  bandValue: { ...typography.monoMd, color: text.primary },
  bandSub: { ...typography.bodySm, color: text.secondary },
  receiptText: { ...typography.bodySm, color: text.primary, flexShrink: 1 },

  record: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  eyebrowRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  eyebrowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  eyebrow: { ...typography.labelCap, color: text.tertiary, flexShrink: 1 },
  age: { ...typography.caption, color: text.tertiary },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...typography.bodyLg, fontWeight: "700", color: text.primary, flexShrink: 1, minWidth: 0 },
  checkSlot: { marginLeft: "auto" },

  contactRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, minHeight: 24 },
  contactValue: { ...typography.monoMd, flexShrink: 1, minWidth: 0 },
  contactMatched: { color: text.primary },
  contactOther: { color: text.secondary },
  matchedMarker: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  matchedMarkerText: { ...typography.micro, color: semantic.warning },
  absence: { ...typography.bodySm, fontStyle: "italic", color: text.tertiary },

  seam: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  seamRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: glass.border.profileElevated },
  seamLabel: { ...typography.labelCap, color: text.secondary },

  candidateList: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  candidateBase: {
    minHeight: 64,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  candidateIdle: {
    minHeight: 64,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  candidateIdleBorder: { borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileElevated },
  candidateSelected: { borderWidth: 1.5, borderColor: accent.warm },

  consequence: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  consequenceText: { ...typography.bodySm, color: text.primary, flexShrink: 1 },

  cardError: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  cardErrorText: { ...typography.bodySm, color: text.primary, flexShrink: 1 },

  outcomes: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  outcomeHint: { ...typography.bodySm, color: text.secondary },

  control: {
    minHeight: 44,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    // 3.09:1 on the card — the LOWEST white alpha that clears SC 1.4.11.
    borderColor: glass.border.control,
    paddingHorizontal: spacing.md,
  },
  controlDisabled: { opacity: 0.45 },
  controlContent: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  controlLabel: { ...typography.buttonMd, color: text.primary },
  controlLabelDim: { opacity: 0.7 },
  pressed: { opacity: 0.78 },
  focusRing: { outlineWidth: 2, outlineColor: accent.warm, outlineOffset: 2 },

  strip: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245, 158, 11, 0.45)",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  stripCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0, gap: spacing.xxs },
  stripCopyStacked: { flexBasis: "100%" },
  stripLine1: { ...typography.bodySm, fontWeight: "600", color: text.primary },
  stripLine2: { ...typography.caption, color: text.secondary },
  stripAction: { flexShrink: 0 },
  stripActionStacked: { flexBasis: "100%", alignSelf: "stretch" },
});


/* ----------------------------------------------------------------- strip --- */

/**
 * The Book-block strip. Renders `null` at zero — hard requirement. No
 * zero-state, no "all filed" confirmation, no ghost, no collapsed rail: #1774's
 * calm People page returns byte-for-byte to its shipped form in the normal case.
 *
 * It also renders `null` in every unsettled query state (loading, error,
 * offlineEmpty, staleError, forbidden). A failed conflicts fetch must NOT make
 * the People page look broken — the worst case is that the operator does not
 * learn about the queue this session, which is exactly today's behaviour and
 * strictly better than a red band on the roster. `offlineStale` DOES render: the
 * cached count is still true.
 *
 * COPY: "buyers", never "records"/"conflicts"/"errors"/"items" — these are
 * humans who paid. No red, no `!` badge, no `semantic.error`: nothing failed and
 * nobody is being scolded. Line 2 converts a count into a debt, which is the
 * line that actually makes an operator tap.
 *
 * NO NAME. A name in a defect strip is a persistent framing of one identified
 * customer as the problem on a page anyone at rank 20+ opens for unrelated
 * reasons, it buys no decision value (nothing is actionable from the strip), and
 * it churns as the queue drains. Time instead: strictly more compelling,
 * strictly less exposing, stable.
 *
 * It is a NON-INTERACTIVE band containing one button — never a Pressable
 * wrapping a Pressable.
 */
export function ConflictReviewStrip({
  kind,
  openCount,
  oldestCreatedAt,
  stacked,
  onReview,
}: {
  kind: ConflictQueryKind;
  openCount: number;
  oldestCreatedAt: string | null;
  stacked: boolean;
  onReview: () => void;
}): React.ReactElement | null {
  if (kind !== "success" && kind !== "refreshing" && kind !== "offlineStale") return null;
  if (openCount <= 0) return null;

  const waitedDays =
    oldestCreatedAt === null
      ? 0
      : Math.floor((Date.now() - new Date(oldestCreatedAt).getTime()) / 86_400_000);

  return (
    <View
      accessibilityLiveRegion="polite"
      testID="people-conflict-strip"
      style={[s.strip, warningFill]}
    >
      <Icon name="inbox" size={20} color={semantic.warning} />
      <View style={[s.stripCopy, stacked ? s.stripCopyStacked : null]}>
        <Text numberOfLines={2} style={s.stripLine1}>
          {openCount === 1
            ? "1 buyer is waiting to be added"
            : `${openCount} buyers are waiting to be added`}
        </Text>
        {waitedDays >= 1 ? (
          <Text style={s.stripLine2}>
            {`Oldest has waited ${waitedDays} ${plural(waitedDays, "day", "days")}.`}
          </Text>
        ) : null}
      </View>
      <View style={[s.stripAction, stacked ? s.stripActionStacked : null]}>
        <OutcomeControl
          kind="button"
          label="Review"
          loading={false}
          disabled={false}
          onPress={onReview}
          accessibilityLabel={`Review ${openCount} ${plural(openCount, "buyer", "buyers")} waiting to be added`}
        />
      </View>
    </View>
  );
}
