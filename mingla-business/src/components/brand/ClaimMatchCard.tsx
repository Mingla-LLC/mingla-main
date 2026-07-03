/**
 * ClaimMatchCard — ORCH-1263 [claim-adoption] DESIGN §4 (evolution of
 * PoolMatchCard). The match moment: prove we really know their place (photo
 * strip + presence-fact pills), then convert the claim into one tap.
 *
 * States: default · YES-loading · fetch-error (explicit "Continue anyway",
 * never silent) · claimState === "claimed" blocked-politely (§4.3, Message
 * support, NO Yes button) · claimState === "pending" (§4.4). Blocked variants
 * are designed out AT THE GATE (I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED) —
 * the six-step dead walk dies here.
 *
 * Facts are PRESENCE BOOLEANS ONLY — never a rating value ("Rated on Google"
 * is the ceiling; the value stays banned server-side).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { PoolMatch } from "../../types/poolMatch";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

// ─── Pure helpers (unit-tested — T-B5) ──────────────────────────────────────

/** Ordered presence facts, rendered ONLY when true (DESIGN §4.1 row 3). */
export function claimCardFacts(match: PoolMatch): string[] {
  const facts: string[] = [];
  const photoCount = match.photoCount ?? 0;
  if (photoCount >= 1) {
    facts.push(`${photoCount} photo${photoCount === 1 ? "" : "s"}`);
  }
  if (match.hasHours === true) facts.push("Hours");
  if (match.hasPhone === true) facts.push("Phone");
  if (match.hasWebsite === true) facts.push("Website");
  if (match.hasRating === true) facts.push("Rated on Google");
  return facts;
}

/** Reassurance renders only when ≥2 facts are true (never promise speed for a
 *  sparse place — DESIGN §4.1 row 4 / §8.5). */
export function shouldShowReassurance(match: PoolMatch): boolean {
  return claimCardFacts(match).length >= 2;
}

/** Blocked variants sort BELOW available ones (DESIGN §4.5) — stable. */
export function sortMatchesForGate(matches: PoolMatch[]): PoolMatch[] {
  const isBlocked = (m: PoolMatch): boolean =>
    m.claimState === "claimed" || m.claimState === "pending";
  return [
    ...matches.filter((m) => !isBlocked(m)),
    ...matches.filter(isBlocked),
  ];
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface ClaimMatchCardProps {
  match: PoolMatch;
  /** "Yes, this is me" pressed — detail fetch in flight. */
  loading?: boolean;
  /** Detail fetch failed — the primary becomes "Continue anyway". */
  fetchError?: boolean;
  onYes: () => void;
  /** Lean whitelist prefill after a failed detail fetch (DESIGN §4.2). */
  onContinueAnyway: () => void;
  onNo: () => void;
  onSkip: () => void;
  /** Blocked variants — routes to /support/inbox (the live-chat surface). */
  onMessageSupport: () => void;
  testID?: string;
}

const PhotoStrip: React.FC<{ match: PoolMatch }> = ({ match }) => {
  const urls = match.photoUrls;
  if (urls.length === 0) {
    // Hue placeholder — never a grey box on the dark canvas (DESIGN §4.1).
    return (
      <EventCoverMedia
        hue={25}
        mediaUrl={null}
        mediaType={null}
        radius={radiusTokens.md}
        label={`Photo of ${match.name}`}
        height={72}
        width={72}
      />
    );
  }
  return (
    <View style={styles.strip}>
      <EventCoverMedia
        hue={25}
        mediaUrl={urls[0]}
        mediaType="image"
        radius={radiusTokens.md}
        label={`Photo of ${match.name}`}
        height={72}
        width={72}
      />
      {urls.length > 1 ? (
        <View style={styles.stripEdge}>
          {[urls[1], urls[2]]
            .filter((u): u is string => typeof u === "string")
            .map((u) => (
              <EventCoverMedia
                key={u}
                hue={25}
                mediaUrl={u}
                mediaType="image"
                radius={6}
                label=""
                height={34}
                width={28}
              />
            ))}
        </View>
      ) : null}
    </View>
  );
};

export const ClaimMatchCard: React.FC<ClaimMatchCardProps> = ({
  match,
  loading = false,
  fetchError = false,
  onYes,
  onContinueAnyway,
  onNo,
  onSkip,
  onMessageSupport,
  testID = "claim-match-card",
}) => {
  const addressLine = [match.address, match.city].filter(Boolean).join(", ");
  const facts = claimCardFacts(match);
  const blocked =
    match.claimState === "claimed" || match.claimState === "pending";

  // ── Blocked politely (DESIGN §4.3 claimed / §4.4 pending) ─────────────────
  if (blocked) {
    const isClaimed = match.claimState === "claimed";
    const bannerText = isClaimed
      ? "This place is already managed on Mingla."
      : "Someone's claim for this place is being reviewed.";
    const bodyText = isClaimed
      ? "If that's you on another account — or you think that's a mistake — message support and we'll sort it out."
      : "If that claim is yours, it's in good hands — check your other account. If not, tell support now so we can look before it's approved.";
    return (
      <GlassCard
        variant="elevated"
        padding={spacing.md}
        testID={testID}
      >
        <View
          accessible
          accessibilityLabel={`${match.name}${addressLine.length > 0 ? `, ${addressLine}` : ""}. ${bannerText}`}
        >
          <View style={styles.row}>
            <PhotoStrip match={match} />
            <View style={styles.textCol}>
              <Text style={styles.name} numberOfLines={2}>
                {match.name}
              </Text>
              {addressLine.length > 0 ? (
                <Text style={styles.address} numberOfLines={2}>
                  {addressLine}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.bannerRow}>
            <Icon
              name={isClaimed ? "shield" : "clock"}
              size={16}
              color={textTokens.secondary}
            />
            <Text style={styles.bannerText}>{bannerText}</Text>
          </View>
          <Text style={styles.blockedBody}>{bodyText}</Text>
        </View>
        <View style={styles.actions}>
          <Button
            label="Message support"
            variant="primary"
            size="md"
            onPress={onMessageSupport}
            testID="claim-match-support"
          />
          <Button
            label="Not your place? Create a new listing"
            variant="ghost"
            size="sm"
            onPress={onNo}
            testID="claim-match-not-mine"
          />
        </View>
      </GlassCard>
    );
  }

  // ── Available (default / loading / fetch-error) ───────────────────────────
  const a11yFacts = facts.length > 0
    ? ` Already on Mingla: ${facts.join(", ")}.`
    : "";
  return (
    <GlassCard variant="elevated" padding={spacing.md} testID={testID}>
      <View
        accessible
        accessibilityLabel={`${match.name}${addressLine.length > 0 ? `, ${addressLine}` : ""}.${a11yFacts} Is this your place?`}
        style={loading ? styles.dimmed : undefined}
      >
        <Text style={styles.eyebrow}>
          We found your place in our directory
        </Text>
        <View style={styles.row}>
          <PhotoStrip match={match} />
          <View style={styles.textCol}>
            <Text style={styles.name} numberOfLines={2}>
              {match.name}
            </Text>
            {addressLine.length > 0 ? (
              <Text style={styles.address} numberOfLines={2}>
                {addressLine}
              </Text>
            ) : null}
          </View>
        </View>
        {facts.length > 0 ? (
          <View style={styles.factsRow}>
            {facts.map((f) => (
              <View key={f} style={styles.factPill}>
                <Text style={styles.factText}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {shouldShowReassurance(match) ? (
          <Text style={styles.reassurance}>
            Most of your listing is already filled in — claiming takes about
            two minutes.
          </Text>
        ) : null}
      </View>
      {fetchError ? (
        <Text style={styles.fetchWarn}>
          Couldn&apos;t pull your full listing — you can still claim and fill
          things in yourself.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={fetchError ? "Continue anyway" : "Yes, this is me"}
          variant="primary"
          size="md"
          loading={loading}
          disabled={loading}
          onPress={fetchError ? onContinueAnyway : onYes}
          testID="claim-match-yes"
        />
        <Button
          label="No, different business"
          variant="secondary"
          size="md"
          disabled={loading}
          onPress={onNo}
          testID="claim-match-no"
        />
        <Button
          label="Skip — create from scratch"
          variant="ghost"
          size="sm"
          disabled={loading}
          onPress={onSkip}
          testID="claim-match-skip"
        />
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  dimmed: {
    opacity: 0.85,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  strip: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  stripEdge: {
    width: 28,
    height: 72,
    flexDirection: "column",
    gap: spacing.xs,
  },
  textCol: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  address: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  factsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  factPill: {
    borderRadius: radiusTokens.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  factText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
    color: textTokens.secondary,
  },
  reassurance: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  fetchWarn: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: semantic.warning,
    marginBottom: spacing.sm,
  },
  bannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  bannerText: {
    flex: 1,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  blockedBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  actions: {
    gap: spacing.sm,
  },
});

export default ClaimMatchCard;
