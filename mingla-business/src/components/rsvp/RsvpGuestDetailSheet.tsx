/**
 * ORCH-1334 — RsvpGuestDetailSheet.
 *
 * Progressive-disclosure detail for a single RSVP guest, opened by tapping a
 * console row. Renders identity (avatar, real name, @username, source badge),
 * where-from (source + RSVP time), status/approval, plus-ones, and a contact
 * block (email always + phone when present for app members; typed contact for
 * web guests) — plus state-gated host actions that mirror the row actions
 * (Pending → Approve/Deny; Going → Remove; Maybe/Waitlist → none).
 *
 * Built on the shared `Sheet` primitive (spring open damping 22 / stiffness 200,
 * 240ms timing close, reduced-motion fallback — inherited, not reinvented). iOS
 * gets the translucent glass panel; Android/web get the opaque fallback the Sheet
 * already provides. Contact rows that are absent are OMITTED entirely — never a
 * fabricated "N/A" (Constitution #9).
 *
 * See SPEC_ORCH-1334 §4E (designer contract).
 */

import React from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import type {
  RsvpApprovalValue,
  RsvpGuest,
  RsvpSourceValue,
  RsvpStatusValue,
} from "../../services/rsvpApprovals";

// ORCH-1334 — avatar helpers copied inline (byte-for-byte from
// app/event/[id]/guests/index.tsx:88-101 per SPEC §4E-10; NOT refactored into a
// shared util this ORCH — kept local to avoid a console↔sheet circular import).
const hashStringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

// AA-safe LIGHTENED badge-text tokens (see RsvpGuestConsole for the full contrast
// rationale). "On Mingla" uses #ffa94d, NOT the brand accent.warm #eb7825 which
// misses AA 4.5:1 on the composited accent.tint fill (3.94:1 iOS / 3.38:1 Android);
// #ffa94d measures 6.00:1 iOS / 5.15:1 Android. The web badge uses #7ab0ff since
// the token #3b82f6 misses AA on the info-tint fill.
const APP_BADGE_TEXT = "#ffa94d";
const WEB_BADGE_TEXT = "#7ab0ff";
const WEB_BADGE_BORDER = "rgba(59, 130, 246, 0.55)";

const STATUS_LABEL: Record<RsvpStatusValue, string> = {
  going: "Going",
  not_going: "Not going",
  waitlisted: "Waitlisted",
  maybe: "Maybe",
};

const APPROVAL_LABEL: Record<RsvpApprovalValue, string> = {
  pending: "Pending approval",
  approved: "Approved",
  denied: "Denied",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "RSVP'd 2 days ago · Jul 8, 3:14 PM" — relative + absolute, dependency-free. */
const formatRsvpTime = (iso: string): string => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const delta = Date.now() - t;
  let relative: string;
  if (delta < MINUTE) relative = "just now";
  else if (delta < HOUR) relative = `${Math.floor(delta / MINUTE)}m ago`;
  else if (delta < DAY) relative = `${Math.floor(delta / HOUR)}h ago`;
  else {
    const d = Math.floor(delta / DAY);
    relative = d === 1 ? "1 day ago" : `${d} days ago`;
  }
  const absolute = new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `RSVP'd ${relative} · ${absolute}`;
};

const AvatarLarge: React.FC<{ guest: RsvpGuest }> = ({ guest }) => {
  const [imgFailed, setImgFailed] = React.useState<boolean>(false);
  const showImage =
    guest.source === "app" &&
    typeof guest.avatarUrl === "string" &&
    guest.avatarUrl.length > 0 &&
    !imgFailed;

  if (showImage) {
    return (
      <Image
        source={{ uri: guest.avatarUrl as string }}
        style={styles.avatar}
        onError={() => setImgFailed(true)}
        accessibilityLabel={`${guest.displayName} avatar`}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        styles.avatarInitials,
        { backgroundColor: `hsl(${hashStringToHue(guest.id)}, 60%, 45%)` },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.avatarInitialsText}>{getInitials(guest.displayName)}</Text>
    </View>
  );
};

const SourceBadge: React.FC<{ source: RsvpSourceValue }> = ({ source }) => {
  const isApp = source === "app";
  return (
    <View
      style={[
        styles.badge,
        isApp
          ? { backgroundColor: accent.tint, borderColor: accent.border }
          : { backgroundColor: semantic.infoTint, borderColor: WEB_BADGE_BORDER },
      ]}
    >
      <Text style={[styles.badgeText, { color: isApp ? APP_BADGE_TEXT : WEB_BADGE_TEXT }]}>
        {isApp ? "On Mingla" : "RSVP'd on web"}
      </Text>
    </View>
  );
};

const SectionLabel: React.FC<{ children: string }> = ({ children }) => (
  <Text style={styles.sectionLabel}>{children}</Text>
);

export interface RsvpGuestDetailSheetProps {
  visible: boolean;
  guest: RsvpGuest | null;
  onClose: () => void;
  onApprove: (g: RsvpGuest) => void;
  onDeny: (g: RsvpGuest) => void;
  onRemove: (g: RsvpGuest) => void;
  isActionPending: boolean;
}

export const RsvpGuestDetailSheet: React.FC<RsvpGuestDetailSheetProps> = ({
  visible,
  guest,
  onClose,
  onApprove,
  onDeny,
  onRemove,
  isActionPending,
}) => {
  // The Sheet stays mounted through its close animation, during which `guest`
  // may already be null — render an empty body then (the Sheet animates out).
  const hasContact = guest !== null && (guest.email !== null || guest.phone !== null);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.62}
      testID="rsvp-guest-detail-sheet"
    >
      {guest === null ? (
        <View />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          accessibilityViewIsModal
        >
          {/* WHO — identity */}
          <View style={styles.identityBlock}>
            <AvatarLarge guest={guest} />
            <Text style={styles.name} numberOfLines={2}>
              {guest.displayName}
            </Text>
            {guest.username !== null && guest.username.length > 0 ? (
              <Text style={styles.username} numberOfLines={1}>
                @{guest.username}
              </Text>
            ) : null}
            <View style={styles.identityBadge}>
              <SourceBadge source={guest.source} />
            </View>
          </View>

          {/* WHERE FROM */}
          <View style={styles.block}>
            <SectionLabel>WHERE FROM</SectionLabel>
            <Text style={styles.value}>
              {guest.source === "app" ? "RSVP'd inside the Mingla app" : "RSVP'd from the public web link"}
            </Text>
            <Text style={styles.meta}>{formatRsvpTime(guest.createdAt)}</Text>
          </View>

          {/* STATUS */}
          <View style={styles.block}>
            <SectionLabel>STATUS</SectionLabel>
            <Text style={styles.value}>
              {STATUS_LABEL[guest.rsvpStatus]} · {APPROVAL_LABEL[guest.approvalStatus]}
            </Text>
          </View>

          {/* PLUS-ONES — only when the guest is bringing extras */}
          {guest.plusCount > 0 ? (
            <View style={styles.block}>
              <SectionLabel>PLUS-ONES</SectionLabel>
              <Text style={styles.value}>
                Bringing {guest.plusCount} {guest.plusCount === 1 ? "guest" : "guests"}
              </Text>
            </View>
          ) : null}

          {/* CONTACT — email always for app; phone when present; omit missing rows */}
          <View style={styles.block}>
            <SectionLabel>CONTACT</SectionLabel>
            {hasContact ? (
              <>
                {guest.email !== null ? (
                  <View style={styles.contactRow}>
                    <Text style={styles.contactLabel}>Email</Text>
                    <Text style={styles.contactValue} selectable>
                      {guest.email}
                    </Text>
                  </View>
                ) : null}
                {guest.phone !== null ? (
                  <View style={styles.contactRow}>
                    <Text style={styles.contactLabel}>Phone</Text>
                    <Text style={styles.contactValue} selectable>
                      {guest.phone}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.meta}>No contact on file.</Text>
            )}
          </View>

          {/* Host actions — state-gated (mirror the row actions) */}
          {guest.approvalStatus === "pending" ? (
            <View style={styles.actionBar}>
              <Button
                label="Approve"
                variant="primary"
                size="md"
                fullWidth
                loading={isActionPending}
                disabled={isActionPending}
                onPress={() => onApprove(guest)}
                accessibilityLabel={`Approve ${guest.displayName}`}
                testID="rsvp-sheet-approve"
              />
              <Button
                label="Deny"
                variant="ghost"
                size="md"
                fullWidth
                disabled={isActionPending}
                onPress={() => onDeny(guest)}
                accessibilityLabel={`Deny ${guest.displayName}`}
                testID="rsvp-sheet-deny"
              />
            </View>
          ) : guest.rsvpStatus === "going" && guest.approvalStatus === "approved" ? (
            <View style={styles.actionBar}>
              <Button
                label="Remove"
                variant="destructive"
                size="md"
                fullWidth
                disabled={isActionPending}
                onPress={() => onRemove(guest)}
                accessibilityLabel={`Remove ${guest.displayName}`}
                testID="rsvp-sheet-remove"
              />
            </View>
          ) : null}
        </ScrollView>
      )}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // The Sheet body already pads spacing.md horizontal; add spacing.sm to reach
  // the §4E-2 spacing.lg (24) inner padding. Vertical block gaps = spacing.lg.
  content: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.lg,
  },
  identityBlock: { alignItems: "center", gap: spacing.sm },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radiusTokens.full,
    backgroundColor: glass.tint.profileBase,
  },
  avatarInitials: { alignItems: "center", justifyContent: "center" },
  avatarInitialsText: { color: "#fff", fontWeight: "700", fontSize: 24 },
  name: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "center",
  },
  username: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  identityBadge: { marginTop: 2 },
  block: { gap: spacing.sm },
  sectionLabel: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: "600",
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  value: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  meta: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  contactRow: {
    minHeight: 44,
    justifyContent: "center",
    gap: 2,
  },
  contactLabel: {
    fontSize: typography.labelCap.fontSize,
    letterSpacing: typography.labelCap.letterSpacing,
    fontWeight: "600",
    color: textTokens.tertiary,
  },
  contactValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  badge: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radiusTokens.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: typography.micro.letterSpacing,
  },
  actionBar: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

export default RsvpGuestDetailSheet;
