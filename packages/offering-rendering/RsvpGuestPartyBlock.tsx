/**
 * RsvpGuestPartyBlock — issue #4508 "Who's coming with you?".
 *
 * Presentational only: the state (party, number draft, live lookup, friends
 * search) is owned by useRsvpOfferingState so the inline box and the floating
 * details modal show one party. Layout (amendments 2-4): the phone number
 * field FIRST with its live preview row, then "Or from your friends" (search
 * box + chips) for a signed-in inviter, then the people added.
 *
 * Package-isolated (I-MOR-0827): ThemePalette only, no app imports.
 */

import React, { useMemo } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { offeringSurfaceStyles, type ThemePalette } from "./themePalette";
import { themeFontFace } from "./themeAccentStyle";
import {
  RSVP_PARTY_COPY,
  addPartyGuest,
  addableFromPreview,
  friendChips,
  formatPartyPhone,
  friendGuest,
  numberPreview,
  removePartyGuest,
  rsvpFriendLine,
  rsvpNoFriendMatch,
  rsvpOnMinglaLine,
  rsvpPartyHelper,
  searchFriends,
  type RsvpFriendOption,
  type RsvpGuestLookupResult,
  type RsvpNumberPreview,
  type RsvpPartyGuest,
} from "./rsvpGuestPartyModel";
import type { RsvpPhoneFieldRenderer, RsvpPlainFieldProps } from "./rsvpPhoneFieldTypes";

const DANGER = "#e5484d";

export interface RsvpGuestPartyBlockProps {
  palette: ThemePalette;
  boldFamily: string;
  max: number;
  party: ReadonlyArray<RsvpPartyGuest>;
  disabled: boolean;
  /** The phone field (injected picker or the plain fallback), built by the hook. */
  numberField: React.ReactNode;
  preview: RsvpNumberPreview;
  canAddNumber: boolean;
  onAddNumber: () => void;
  onRetryLookup: (() => void) | null;
  onRemove: (key: string) => void;
  /** null ⇒ no friends section (signed out, or the surface offers none). */
  friends: {
    query: string;
    onQueryChange: (value: string) => void;
    results: ReadonlyArray<RsvpFriendOption>;
    chips: ReadonlyArray<RsvpFriendOption>;
    loading: boolean;
    error: string | null;
    onRetry: (() => void) | null;
    onPick: (friend: RsvpFriendOption) => void;
  } | null;
  testID?: string;
}

export const RsvpGuestPartyBlock: React.FC<RsvpGuestPartyBlockProps> = ({
  palette,
  boldFamily,
  max,
  party,
  disabled,
  numberField,
  preview,
  canAddNumber,
  onAddNumber,
  onRetryLookup,
  onRemove,
  friends,
  testID = "issue-4508-rsvp-party",
}) => {
  const surface = offeringSurfaceStyles(palette);
  const boldFace = themeFontFace(boldFamily);
  const atLimit = party.length >= max;
  const query = friends?.query.trim() ?? "";

  const addButton = (
    label: string,
    onPress: () => void,
    enabled: boolean,
    a11y: string,
    id: string,
  ): React.ReactNode => (
    <Pressable
      onPress={enabled && !disabled ? onPress : undefined}
      disabled={!enabled || disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !enabled || disabled }}
      hitSlop={6}
      style={[
        styles.addBtn,
        {
          backgroundColor: palette.primaryText,
          opacity: enabled && !disabled ? 1 : 0.35,
        },
      ]}
      testID={id}
    >
      <Text style={[styles.addBtnText, { color: palette.page }, boldFace]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.block, surface.card]} testID={testID}>
      <Text style={[styles.title, surface.primaryText, boldFace]}>
        {RSVP_PARTY_COPY.title}
      </Text>
      <Text style={[styles.helper, surface.secondaryText]}>
        {rsvpPartyHelper(max)}
      </Text>

      {atLimit ? (
        <Text
          style={[styles.limit, surface.secondaryText]}
          accessibilityLiveRegion="polite"
          testID="issue-4508-rsvp-party-limit"
        >
          {RSVP_PARTY_COPY.limitReached}
        </Text>
      ) : (
        <>
          {/* By phone number (first: adding a new person is fastest). */}
          <View style={styles.numberRow} testID="issue-4508-rsvp-party-number">
            <View style={styles.numberField}>{numberField}</View>
            <View style={styles.numberAdd}>
              {addButton(
                RSVP_PARTY_COPY.add,
                onAddNumber,
                canAddNumber,
                "Add this number",
                "issue-4508-rsvp-party-number-add",
              )}
            </View>
          </View>

          {preview.kind === "checking" ? (
            <View style={styles.previewRow} testID="issue-4508-rsvp-party-preview-checking">
              <ActivityIndicator size="small" color={palette.secondaryText} />
              <Text style={[styles.previewLine, surface.secondaryText]}>
                {RSVP_PARTY_COPY.checking}
              </Text>
            </View>
          ) : preview.kind === "refused" ? (
            <Text
              style={styles.refused}
              accessibilityLiveRegion="polite"
              testID="issue-4508-rsvp-party-preview-refused"
            >
              {preview.message}
            </Text>
          ) : preview.kind === "ready" || preview.kind === "unchecked" ? (
            <View
              style={[styles.personRow, { borderColor: palette.panelBorder }]}
              testID="issue-4508-rsvp-party-preview"
            >
              <View style={styles.personText}>
                <Text style={[styles.personName, surface.primaryText, boldFace]} numberOfLines={1}>
                  {preview.title}
                </Text>
                <Text style={[styles.personLine, surface.secondaryText]} numberOfLines={2}>
                  {preview.line}
                </Text>
                {preview.kind === "unchecked" ? (
                  <Text style={[styles.personLine, surface.tertiaryText]}>
                    {preview.message}
                  </Text>
                ) : null}
              </View>
              {preview.kind === "unchecked" && onRetryLookup !== null ? (
                <Pressable
                  onPress={disabled ? undefined : onRetryLookup}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel="Check this number again"
                  hitSlop={6}
                  style={styles.linkBtn}
                  testID="issue-4508-rsvp-party-preview-retry"
                >
                  <Text style={[styles.linkText, { color: palette.accent }]}>Check again</Text>
                </Pressable>
              ) : null}
              {addButton(
                RSVP_PARTY_COPY.add,
                onAddNumber,
                canAddNumber,
                `Add ${preview.title}`,
                "issue-4508-rsvp-party-preview-add",
              )}
            </View>
          ) : null}

          {/* Or from your friends (signed-in only). */}
          {friends !== null ? (
            <View style={styles.friends} testID="issue-4508-rsvp-party-friends">
              <Text style={[styles.sectionLabel, surface.tertiaryText]}>
                {RSVP_PARTY_COPY.friendsLabel}
              </Text>
              <TextInput
                value={friends.query}
                onChangeText={friends.onQueryChange}
                placeholder={RSVP_PARTY_COPY.friendsPlaceholder}
                placeholderTextColor={palette.tertiaryText}
                autoCapitalize="none"
                autoCorrect={false}
                // Never the device's own contact card in a friend search.
                textContentType="none"
                autoComplete="off"
                importantForAutofill="no"
                returnKeyType="search"
                editable={!disabled}
                accessibilityLabel="Search friends"
                style={[
                  styles.searchInput,
                  {
                    color: palette.primaryText,
                    backgroundColor: palette.page,
                    borderColor: palette.panelBorder,
                  },
                ]}
                testID="issue-4508-rsvp-party-friend-search"
              />
              {friends.loading ? (
                <View style={styles.previewRow}>
                  <ActivityIndicator size="small" color={palette.secondaryText} />
                  <Text style={[styles.previewLine, surface.secondaryText]}>
                    Loading your friends…
                  </Text>
                </View>
              ) : friends.error !== null ? (
                <View style={styles.previewRow} testID="issue-4508-rsvp-party-friends-error">
                  <Text style={[styles.previewLine, surface.secondaryText]}>{friends.error}</Text>
                  {friends.onRetry !== null ? (
                    <Pressable
                      onPress={friends.onRetry}
                      accessibilityRole="button"
                      accessibilityLabel="Try loading your friends again"
                      hitSlop={6}
                      style={styles.linkBtn}
                    >
                      <Text style={[styles.linkText, { color: palette.accent }]}>Try again</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : query.length > 0 ? (
                friends.results.length === 0 ? (
                  <Text
                    style={[styles.previewLine, surface.secondaryText]}
                    testID="issue-4508-rsvp-party-friend-empty"
                  >
                    {rsvpNoFriendMatch(query)}
                  </Text>
                ) : (
                  friends.results.map((friend) => (
                    <View
                      key={friend.userId}
                      style={[styles.personRow, { borderColor: palette.panelBorder }]}
                      testID={`issue-4508-rsvp-party-friend-${friend.userId}`}
                    >
                      <View style={styles.personText}>
                        <Text style={[styles.personName, surface.primaryText, boldFace]} numberOfLines={1}>
                          {friend.displayName}
                        </Text>
                        <Text style={[styles.personLine, surface.secondaryText]} numberOfLines={1}>
                          {rsvpFriendLine(friend.username)}
                        </Text>
                      </View>
                      {addButton(
                        RSVP_PARTY_COPY.add,
                        () => friends.onPick(friend),
                        true,
                        `Add ${friend.displayName}`,
                        `issue-4508-rsvp-party-friend-add-${friend.userId}`,
                      )}
                    </View>
                  ))
                )
              ) : friends.chips.length > 0 ? (
                <View testID="issue-4508-rsvp-party-chips">
                  <Text style={[styles.chipsLabel, surface.tertiaryText]}>
                    {RSVP_PARTY_COPY.chipsLabel}
                  </Text>
                  <View style={styles.chipsRow}>
                    {friends.chips.map((friend) => (
                      <Pressable
                        key={friend.userId}
                        onPress={disabled ? undefined : () => friends.onPick(friend)}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${friend.displayName}`}
                        style={[
                          styles.chip,
                          { borderColor: palette.panelBorder, backgroundColor: palette.accentWash },
                        ]}
                        testID={`issue-4508-rsvp-party-chip-${friend.userId}`}
                      >
                        <Text style={[styles.chipText, surface.primaryText]} numberOfLines={1}>
                          {`+ ${friend.displayName}`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      {/* The people added. */}
      {party.map((guest) => {
        const title = guest.label;
        const line = guest.onMingla
          ? guest.source === "friend"
            ? rsvpFriendLine(guest.username)
            : rsvpOnMinglaLine(guest.username)
          : RSVP_PARTY_COPY.notOnMingla;
        return (
          <View
            key={guest.key}
            style={[styles.personRow, { borderColor: palette.panelBorder }]}
            testID={`issue-4508-rsvp-party-guest-${guest.key}`}
          >
            <View style={styles.personText}>
              <Text style={[styles.personName, surface.primaryText, boldFace]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[styles.personLine, surface.secondaryText]} numberOfLines={2}>
                {guest.displayName !== null && guest.phone !== null && guest.source === "number"
                  ? `${formatPartyPhone(guest.phone)} · ${line}`
                  : line}
              </Text>
            </View>
            <Pressable
              onPress={disabled ? undefined : () => onRemove(guest.key)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${title}`}
              hitSlop={8}
              style={styles.removeBtn}
              testID={`issue-4508-rsvp-party-remove-${guest.key}`}
            >
              <Text style={[styles.removeText, surface.secondaryText]}>Remove</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  block: { borderRadius: 18, padding: 18, marginBottom: 14, overflow: "hidden" },
  title: { fontSize: 16, fontWeight: "700" },
  helper: { fontSize: 13, fontWeight: "500", marginTop: 3, marginBottom: 10 },
  limit: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  numberRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  numberField: { flex: 1, minWidth: 0 },
  // Lines the Add button up with the field, above the field's error slot.
  numberAdd: { paddingBottom: 14 },
  sectionLabel: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    flexWrap: "wrap",
  },
  previewLine: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  refused: { color: DANGER, fontSize: 13, lineHeight: 18, marginBottom: 6 },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  personText: { flex: 1, minWidth: 0 },
  personName: { fontSize: 15, fontWeight: "700" },
  personLine: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  addBtn: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: 22,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { fontSize: 14, fontWeight: "800" },
  linkBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  linkText: { fontSize: 13, fontWeight: "700" },
  removeBtn: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  removeText: { fontSize: 13, fontWeight: "700" },
  friends: { marginTop: 14 },
  searchInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    fontSize: 15,
    marginBottom: 6,
  },
  chipsLabel: { fontSize: 12, fontWeight: "600", marginTop: 6, marginBottom: 6 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    justifyContent: "center",
    maxWidth: 200,
  },
  chipText: { fontSize: 14, fontWeight: "600" },
});

type RsvpGuestLookupState =
  | { phone: string; state: "checking" }
  | { phone: string; state: "done"; result: RsvpGuestLookupResult }
  | { phone: string; state: "failed" }
  | null;

export interface RsvpGuestPartyPanelProps {
  palette: ThemePalette;
  boldFamily: string;
  max: number;
  party: RsvpPartyGuest[];
  setParty: (update: (current: RsvpPartyGuest[]) => RsvpPartyGuest[]) => void;
  disabled: boolean;
  numberCountry: string | null;
  setNumberCountry: (iso: string | null) => void;
  numberRaw: string;
  setNumberRaw: (raw: string) => void;
  numberE164: string;
  setNumberE164: (e164: string) => void;
  lookupState: RsvpGuestLookupState;
  setLookupState: (state: RsvpGuestLookupState) => void;
  /** false ⇒ this surface has no lookup: a valid number is simply invited. */
  lookupEnabled: boolean;
  onRetryLookup: () => void;
  ownPhones: ReadonlyArray<string>;
  friendQuery: string;
  setFriendQuery: (value: string) => void;
  /** undefined ⇒ no friends section (signed out, or the surface offers none). */
  friendList: ReadonlyArray<RsvpFriendOption> | undefined;
  friendsLoading: boolean;
  friendsError: string | null;
  onRetryFriends: (() => void) | null;
  renderPhoneField?: RsvpPhoneFieldRenderer;
  /** The body's plain text field, used when the surface injects no phone picker. */
  PlainField: React.ComponentType<RsvpPlainFieldProps>;
  testID?: string;
}

/**
 * The RSVP body's "Who's coming with you?" logic, kept next to its block so
 * both ride the same on-demand chunk. The body owns the state (so the inline
 * form and the details modal share one party); this derives the live preview,
 * the add / remove handlers, the number field and the friends section.
 */
export const RsvpGuestPartyPanel: React.FC<RsvpGuestPartyPanelProps> = (p) => {
  const { numberE164, numberCountry, lookupState, party, lookupEnabled } = p;
  const guestNumberPreview = useMemo(() => {
    const phone = numberE164.trim();
    const lookup = !lookupEnabled
      ? {
          // No lookup on this surface: a valid number is simply invited.
          state: "done" as const,
          result: {
            valid: true,
            onMingla: false,
            userId: null,
            displayName: null,
            username: null,
            avatarUrl: null,
            isYou: false,
            alreadyOnList: false,
            released: false,
          },
        }
      : lookupState === null || lookupState.phone !== phone
        ? { state: "none" as const }
        : lookupState.state === "done"
          ? { state: "done" as const, result: lookupState.result }
          : { state: lookupState.state };
    return numberPreview({
      phone,
      phoneCountryIso: numberCountry,
      party,
      // The body passes its phone fields as they are; empty ones are not numbers.
      ownPhones: p.ownPhones.filter((own) => own.trim().length > 0),
      lookup,
    });
  }, [numberE164, numberCountry, lookupEnabled, lookupState, party, p.ownPhones]);
  const addableGuest = addableFromPreview(guestNumberPreview);

  const clearGuestNumber = (): void => {
    p.setNumberRaw("");
    p.setNumberE164("");
    p.setLookupState(null);
  };
  const addGuestFromNumber = (): void => {
    if (p.disabled || addableGuest === null) return;
    p.setParty((current: RsvpPartyGuest[]) => addPartyGuest(current, addableGuest, p.max));
    clearGuestNumber();
    if (Platform.OS !== "web") {
      AccessibilityInfo.announceForAccessibility?.(`${addableGuest.label} added.`);
    }
  };
  const addGuestFriend = (friend: RsvpFriendOption): void => {
    if (p.disabled) return;
    p.setParty((current: RsvpPartyGuest[]) => addPartyGuest(current, friendGuest(friend), p.max));
    p.setFriendQuery("");
    if (Platform.OS !== "web") {
      AccessibilityInfo.announceForAccessibility?.(`${friend.displayName} added.`);
    }
  };
  const removeGuest = (key: string): void => {
    if (p.disabled) return;
    p.setParty((current: RsvpPartyGuest[]) => removePartyGuest(current, key));
  };

  const guestNumberInvalid =
    p.numberRaw.trim().length > 0 &&
    p.numberE164.trim().length === 0 &&
    p.numberRaw.replace(/\D/g, "").length >= 7;
  const numberField: React.ReactNode = p.renderPhoneField ? (
    p.renderPhoneField({
      role: "plus_one",
      guestId: null,
      index: null,
      label: RSVP_PARTY_COPY.numberLabel,
      testID: "issue-4508-rsvp-guest-phone",
      countryCode: p.numberCountry,
      rawValue: p.numberRaw,
      onChangeCountry: (isoCode, resolvedE164) => {
        p.setNumberCountry(isoCode);
        p.setNumberE164(resolvedE164 ?? "");
      },
      onChangeRawValue: (raw, resolvedE164) => {
        p.setNumberRaw(raw);
        p.setNumberE164(resolvedE164 ?? "");
      },
      invalid: guestNumberInvalid,
      errorText: guestNumberInvalid ? RSVP_PARTY_COPY.invalid : null,
      palette: p.palette,
      disabled: p.disabled,
      required: false,
      emptyRequired: false,
      onBlur: () => undefined,
      disableAutofill: true,
      onSubmitEditing: addGuestFromNumber,
    })
  ) : (
    <p.PlainField
      label={RSVP_PARTY_COPY.numberLabel}
      value={p.numberRaw}
      onChangeText={(value: string) => {
        // Digits, spaces, +, brackets and dashes only: never letters.
        const cleaned = value.replace(/[^0-9+()\-\s]/g, "");
        p.setNumberRaw(cleaned);
        const compact = cleaned.replace(/[\s()\-]/g, "");
        p.setNumberE164(/^\+[1-9][0-9]{7,14}$/.test(compact) ? compact : "");
      }}
      placeholder="+1 555 123 4567"
      palette={p.palette}
      invalid={
        p.numberRaw.trim().length > 0 &&
        p.numberE164.length === 0 &&
        p.numberRaw.replace(/\D/g, "").length >= 8
      }
      invalidMsg={RSVP_PARTY_COPY.invalid}
      keyboardType="phone-pad"
      autoCapitalize="none"
      disableAutofill
      onSubmitEditing={addGuestFromNumber}
      testID="issue-4508-rsvp-guest-phone-plain"
      disabled={p.disabled}
    />
  );

  const friendList = p.friendList;
  const friendsSection =
    friendList !== undefined
      ? {
          query: p.friendQuery,
          onQueryChange: p.setFriendQuery,
          results: searchFriends(friendList, p.friendQuery, party),
          chips: friendChips(friendList, party),
          loading: p.friendsLoading,
          error: p.friendsError,
          onRetry: p.onRetryFriends,
          onPick: addGuestFriend,
        }
      : null;

  return (
    <RsvpGuestPartyBlock
      palette={p.palette}
      boldFamily={p.boldFamily}
      max={p.max}
      party={party}
      disabled={p.disabled}
      numberField={numberField}
      preview={guestNumberPreview}
      canAddNumber={addableGuest !== null && !p.disabled}
      onAddNumber={addGuestFromNumber}
      onRetryLookup={lookupEnabled ? p.onRetryLookup : null}
      onRemove={removeGuest}
      friends={friendsSection}
      testID={p.testID}
    />
  );
};

// ── issue #4508 T1: the signed-out "Bring someone" card ───────────────────
// Adding a plus-one by number needs a signed-in Mingla account, so a
// signed-out viewer (buyer web) gets this card where the guest section would
// be: the RSVP itself stays one tap, and "Get the app" opens the surface's own
// app download / deep link for this event. It lives in this on-demand module
// (the guest section's own chunk), so it never rides the boot payload.
export const RSVP_BRING_SOMEONE_TITLE = "Bring someone";
export const RSVP_BRING_SOMEONE_BODY =
  "Add a friend with just their number in the Mingla app. They'll get their own pass.";
export const RSVP_BRING_SOMEONE_CTA = "Get the app";

export interface RsvpBringSomeoneCardProps {
  palette: ThemePalette;
  boldFamily: string;
  /** Opens the app download / deep link for this event. Absent ⇒ no button. */
  onGetApp?: () => void;
}

export function RsvpBringSomeoneCard(props: RsvpBringSomeoneCardProps): React.ReactElement {
  const surface = offeringSurfaceStyles(props.palette);
  const boldFace = themeFontFace(props.boldFamily);
  const onGetApp = props.onGetApp;
  return (
    <View style={[cardStyles.card, surface.card]} testID="issue-4508-rsvp-bring-someone">
      <Text style={[cardStyles.title, surface.primaryText, boldFace]} accessibilityRole="header">
        {RSVP_BRING_SOMEONE_TITLE}
      </Text>
      <Text style={[cardStyles.body, surface.secondaryText]}>{RSVP_BRING_SOMEONE_BODY}</Text>
      {onGetApp !== undefined ? (
        <Pressable
          onPress={onGetApp}
          accessibilityRole="button"
          accessibilityLabel={`${RSVP_BRING_SOMEONE_CTA} to bring someone`}
          style={[cardStyles.cta, { backgroundColor: props.palette.primaryText }]}
          testID="issue-4508-rsvp-bring-someone-get-app"
        >
          <Text style={[cardStyles.ctaText, { color: props.palette.page }, boldFace]}>
            {RSVP_BRING_SOMEONE_CTA}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: { borderRadius: 18, padding: 18, marginBottom: 14, gap: 8 },
  title: { fontSize: 17, lineHeight: 22 },
  body: { fontSize: 14, lineHeight: 20 },
  cta: {
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: "center",
    marginTop: 4,
  },
  ctaText: { fontSize: 15 },
});

/** issue #4508 T1 — the guest section: signed out, the "Bring someone" card;
 * signed in, the party panel. One on-demand module, one eager mount point. */
export interface RsvpGuestSectionProps extends RsvpGuestPartyPanelProps {
  signedOut?: boolean;
  onGetApp?: () => void;
}

export function RsvpGuestSection(p: RsvpGuestSectionProps): React.ReactElement {
  return p.signedOut === true ? (
    <RsvpBringSomeoneCard palette={p.palette} boldFamily={p.boldFamily} onGetApp={p.onGetApp} />
  ) : (
    <RsvpGuestPartyPanel {...p} />
  );
}

export default RsvpGuestSection;
