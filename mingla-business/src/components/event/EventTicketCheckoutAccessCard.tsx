/**
 * EventTicketCheckoutAccessCard (web / DEFAULT half) — issue #2101
 * [named-buyer checkout]. Amendment 1 §A7 as respelled by Amendment 8 §A8.1.
 *
 * Platform isolation is filename-enforced by the `.native` OVERRIDE (Metro
 * resolves `X.native.tsx` before `X.tsx` on iOS/Android), so no native Business
 * screen gains a configuration control.
 *
 * The ONE owner-only "Eligible buyers" card, mounted on the published
 * Event / Experience / Trip management surfaces. It is backed by a single
 * service module and a single hook, so no policy logic is duplicated per
 * offering type.
 *
 * PRIVACY. The list shows only what the server already made public: the
 * caller's own row renders as "My account", a public unblocked profile renders
 * its already-public fields, and every other approved account renders the
 * neutral "Approved private account" with all identity fields null. Adding by
 * username is EXACT normalized equality only — missing, private, inactive,
 * blocked and ambiguous all return the same single answer, so the card can
 * never be used to probe whether an account exists.
 *
 * CONCURRENCY. Every mutation carries a client `requestId` and the exact
 * `expectedConfigRevision` the operator saw. A stale revision returns
 * STALE_ACCESS_POLICY and the card refetches; a replayed request returns the
 * prior result unchanged; a restrictive change while a checkout is in flight
 * returns ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE with remediation copy.
 */

import React, { useCallback, useMemo, useState } from "react";
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
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useEventTicketCheckoutAccess } from "../../hooks/useEventTicketCheckoutAccess";
import {
  eventTicketCheckoutAccessErrorCode,
  type EventTicketCheckoutAccessErrorCode,
} from "../../services/eventTicketCheckoutAccessService";

export interface EventTicketCheckoutAccessCardProps {
  /** The offering's canonical events-row UUID. */
  eventId: string;
  testID?: string;
}

const ERROR_COPY: Record<EventTicketCheckoutAccessErrorCode, string> = {
  FORBIDDEN:
    "Only the brand owner can change who may buy. Ask the owner to update this.",
  BUYER_NOT_AVAILABLE:
    "That username can't be added. Check the spelling, or ask them to add you as a contact and make their profile public.",
  STALE_ACCESS_POLICY:
    "Someone else changed this list while you were editing. We reloaded it — please try again.",
  IDEMPOTENCY_CONFLICT:
    "That change was already submitted with different details. Reload and try again.",
  ACTIVE_CHECKOUTS_BLOCK_ACCESS_CHANGE:
    "A checkout is still in progress for this event. Close sales and let the in-flight checkouts finish, then try again.",
  MAX_ACTIVE_BUYERS:
    "This sale already has the maximum of 20 approved accounts. Remove one first.",
  INVALID_ACCESS_MODE: "That setting isn't valid. Reload and try again.",
};

const newRequestId = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  // Deterministic non-crypto fallback for environments without WebCrypto. The
  // value is only an idempotency handle; the server owns all authority.
  return `req-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

export const EventTicketCheckoutAccessCard: React.FC<
  EventTicketCheckoutAccessCardProps
> = ({ eventId, testID = "issue-2101-eligible-buyers-card" }) => {
  const access = useEventTicketCheckoutAccess(eventId);
  const [username, setUsername] = useState<string>("");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<
    "unrestricted" | "named_buyers" | null
  >(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const data = access.data;
  const revision = data?.configRevision ?? 0;
  const members = useMemo(() => data?.members ?? [], [data?.members]);
  const saving =
    access.addSelf.isPending ||
    access.addUsername.isPending ||
    access.removeMember.isPending ||
    access.setMode.isPending;

  const handleError = useCallback(
    (error: unknown): void => {
      const code = eventTicketCheckoutAccessErrorCode(error);
      setBanner(
        code === null
          ? "That didn't save. Check your connection and try again."
          : ERROR_COPY[code],
      );
      if (code === "STALE_ACCESS_POLICY") access.refetch();
    },
    [access],
  );

  const handleAddSelf = useCallback((): void => {
    setBanner(null);
    access.addSelf.mutate(
      { expectedConfigRevision: revision, requestId: newRequestId() },
      {
        onSuccess: () => setAnnouncement("Your account can now buy."),
        onError: handleError,
      },
    );
  }, [access.addSelf, handleError, revision]);

  const handleAddUsername = useCallback((): void => {
    const value = username.trim();
    if (value.length === 0) {
      setBanner("Enter the exact Mingla username you want to approve.");
      return;
    }
    setBanner(null);
    access.addUsername.mutate(
      {
        username: value,
        expectedConfigRevision: revision,
        requestId: newRequestId(),
      },
      {
        onSuccess: () => {
          setUsername("");
          setAnnouncement("Account approved for this sale.");
        },
        onError: handleError,
      },
    );
  }, [access.addUsername, handleError, revision, username]);

  const handleRemove = useCallback(
    (membershipId: string): void => {
      setBanner(null);
      setPendingRemoval(null);
      access.removeMember.mutate(
        {
          membershipId,
          expectedConfigRevision: revision,
          requestId: newRequestId(),
        },
        {
          onSuccess: () => setAnnouncement("Account removed from this sale."),
          onError: handleError,
        },
      );
    },
    [access.removeMember, handleError, revision],
  );

  const handleSetMode = useCallback(
    (mode: "unrestricted" | "named_buyers"): void => {
      setBanner(null);
      setPendingMode(null);
      access.setMode.mutate(
        { mode, expectedConfigRevision: revision, requestId: newRequestId() },
        {
          onSuccess: () =>
            setAnnouncement(
              mode === "named_buyers"
                ? "Only approved accounts can buy now."
                : "Anyone can buy again.",
            ),
          onError: handleError,
        },
      );
    },
    [access.setMode, handleError, revision],
  );

  if (access.loading) {
    return (
      <View style={styles.host} testID={`${testID}-loading`}>
        <Text style={styles.heading}>Eligible buyers</Text>
        <View style={styles.row}>
          <ActivityIndicator size="small" color={accent.warm} />
          <Text style={styles.body}>Loading who can buy…</Text>
        </View>
      </View>
    );
  }

  if (access.error !== null && access.error !== undefined) {
    return (
      <View style={styles.host} testID={`${testID}-error`}>
        <Text style={styles.heading}>Eligible buyers</Text>
        <Text style={styles.body} accessibilityRole="alert">
          We couldn&rsquo;t load who can buy this ticket.
        </Text>
        <Pressable
          onPress={access.refetch}
          accessibilityRole="button"
          accessibilityLabel="Retry loading eligible buyers"
          style={styles.secondaryButton}
          testID={`${testID}-retry`}
        >
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const restricted = data?.mode === "named_buyers";

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.heading} accessibilityRole="header">
        Eligible buyers
      </Text>
      <Text style={styles.body}>
        {restricted
          ? "Only the approved Mingla accounts below can check out. The page stays public — everyone else just can't buy."
          : "Anyone can buy this ticket. Turn on approved-accounts-only to limit checkout to specific signed-in Mingla accounts."}
      </Text>

      {banner !== null ? (
        <Text
          style={styles.banner}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID={`${testID}-banner`}
        >
          {banner}
        </Text>
      ) : null}
      {announcement !== null ? (
        <Text
          style={styles.announcement}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID={`${testID}-announcement`}
        >
          {announcement}
        </Text>
      ) : null}

      {restricted && members.length === 0 ? (
        <Text style={styles.warning} testID={`${testID}-empty-warning`}>
          No accounts are approved yet, so nobody can buy. Add at least one
          account, or switch back to letting anyone buy.
        </Text>
      ) : null}

      <View style={styles.list}>
        {members.map((member) => (
          <View
            key={member.membershipId}
            style={styles.member}
            testID={`${testID}-member-${member.membershipId}`}
          >
            <Text style={styles.memberLabel} numberOfLines={1}>
              {member.label}
            </Text>
            {pendingRemoval === member.membershipId ? (
              <View style={styles.row}>
                <Pressable
                  onPress={() => handleRemove(member.membershipId)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saving }}
                  accessibilityLabel={`Confirm removing ${member.label}`}
                  style={styles.dangerButton}
                  testID={`${testID}-confirm-remove-${member.membershipId}`}
                >
                  <Text style={styles.dangerButtonText}>Remove</Text>
                </Pressable>
                <Pressable
                  onPress={() => setPendingRemoval(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Keep this account"
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>Keep</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setPendingRemoval(member.membershipId)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ disabled: saving }}
                accessibilityLabel={`Remove ${member.label}`}
                style={styles.secondaryButton}
                testID={`${testID}-remove-${member.membershipId}`}
              >
                <Text style={styles.secondaryButtonText}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      <Pressable
        onPress={handleAddSelf}
        disabled={saving}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        accessibilityLabel="Add my account to the approved buyers"
        style={styles.primaryButton}
        testID={`${testID}-add-self`}
      >
        <Text style={styles.primaryButtonText}>Add my account</Text>
      </Pressable>

      <Text
        style={styles.fieldLabel}
        nativeID={`${testID}-username-label`}
        accessibilityRole="text"
      >
        Approve by Mingla username
      </Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="exact username"
        placeholderTextColor={textTokens.quaternary}
        editable={!saving}
        accessibilityLabel="Approve by Mingla username"
        style={styles.input}
        testID={`${testID}-username-input`}
      />
      <Pressable
        onPress={handleAddUsername}
        disabled={saving}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        accessibilityLabel="Approve this username"
        style={styles.secondaryButton}
        testID={`${testID}-add-username`}
      >
        <Text style={styles.secondaryButtonText}>Approve username</Text>
      </Pressable>

      {pendingMode !== null ? (
        <View style={styles.confirm} testID={`${testID}-mode-confirm`}>
          <Text style={styles.body}>
            {pendingMode === "named_buyers"
              ? "Only the approved accounts will be able to buy. Everything else about this page stays the same."
              : "Anyone will be able to buy again. Your approved list is kept."}
          </Text>
          <View style={styles.row}>
            <Pressable
              onPress={() => handleSetMode(pendingMode)}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              accessibilityLabel="Confirm this change"
              style={styles.primaryButton}
              testID={`${testID}-mode-confirm-yes`}
            >
              <Text style={styles.primaryButtonText}>Confirm</Text>
            </Pressable>
            <Pressable
              onPress={() => setPendingMode(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel this change"
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() =>
            setPendingMode(restricted ? "unrestricted" : "named_buyers")
          }
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          accessibilityLabel={
            restricted
              ? "Let anyone buy this ticket"
              : "Limit checkout to approved accounts"
          }
          style={styles.secondaryButton}
          testID={`${testID}-toggle-mode`}
        >
          <Text style={styles.secondaryButtonText}>
            {restricted ? "Let anyone buy" : "Limit to approved accounts"}
          </Text>
        </Pressable>
      )}

      {saving ? (
        <View style={styles.row} testID={`${testID}-saving`}>
          <ActivityIndicator size="small" color={accent.warm} />
          <Text style={styles.body}>Saving…</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: accent.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  heading: {
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  banner: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: accent.warm,
    fontWeight: "600",
  },
  announcement: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  warning: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: accent.warm,
    fontWeight: "600",
  },
  list: { gap: spacing.xs },
  member: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  memberLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
    fontWeight: "600",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: textTokens.secondary,
  },
  input: {
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: accent.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  primaryButton: {
    alignSelf: "flex-start",
    borderRadius: radiusTokens.sm,
    backgroundColor: accent.warm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  primaryButtonText: {
    fontSize: typography.buttonMd.fontSize,
    fontWeight: "700",
    color: textTokens.inverse,
  },
  secondaryButton: {
    alignSelf: "flex-start",
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
    borderColor: accent.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontSize: typography.buttonMd.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
  dangerButton: {
    alignSelf: "flex-start",
    borderRadius: radiusTokens.sm,
    backgroundColor: accent.warm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  dangerButtonText: {
    fontSize: typography.buttonMd.fontSize,
    fontWeight: "700",
    color: textTokens.inverse,
  },
  confirm: { gap: spacing.sm },
});
