/**
 * /accept-brand-invitation/success — post-accept celebration screen.
 * ORCH-1081.
 *
 * Mounted from /accept-brand-invitation after a partner-setup invite is
 * accepted (transferred=true AND partner_setup=true). Renders:
 *   - 🎉 hero
 *   - "Welcome to {BrandName}" + partner attribution line
 *   - Primary: "Set up {BrandName} on the web →" → /brand/{id}/payments
 *   - Secondary: the shared BusinessAppDownloadCta (ORCH-1378)
 *   - Footer: "Or come back to your email anytime."
 *
 * ─── ORCH-1378 — what the store CTA used to be, and why it was wrong ───────
 * This screen shipped a HARDCODED, NON-ATTRIBUTED, NON-DEVICE-AWARE pair of
 * buttons ("Download for iOS" / "Download for Android"), shown to EVERYONE
 * regardless of platform, opened via `window.location.href = url` — which
 * DESTROYS the page rather than opening a tab.
 *
 * Three separate defects in one control:
 *  1. NO ATTRIBUTION — plain store listings carry no `af_tranid`, so every
 *     install from this screen was invisible to AppsFlyer.
 *  2. The user had to self-identify their own platform.
 *  3. location.href killed the celebration page on the way out.
 *
 * It is now the shared, OneLink-attributed, device-aware CTA. Because the URLs
 * are gone, this file has ALSO been REMOVED from the ORCH-1342 gate's
 * GRANDFATHERED map (the gate's own entry named this as debt "needing BUSINESS_*
 * SSOT entries in a follow-up ORCH" — this is that follow-up). A grandfather
 * entry left behind after the debt is paid is a decorative guard.
 *
 * Query params (all optional except brand_id):
 *   - brand_id      — UUID of the now-owned brand. Required.
 *   - brand         — brand slug (used in copy when name lookup fails).
 *   - owner_name    — new owner first name (used in body copy).
 *
 * We re-fetch the brand row by id when present so we surface the canonical
 * display name; the slug param is a fallback for the loading state. RLS on
 * brands allows the new owner (via brands.account_id = auth.uid()) to read
 * their own brand.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { Button } from "../../src/components/ui/Button";
import { BusinessAppDownloadCta } from "../../src/components/invite/BusinessAppDownloadCta";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { supabase } from "../../src/services/supabase";

export default function AcceptBrandInvitationSuccess(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    brand_id?: string | string[];
    brand?: string | string[];
    owner_name?: string | string[];
  }>();
  const brandId = pickFirst(params.brand_id);
  const brandSlug = pickFirst(params.brand);
  const ownerName = pickFirst(params.owner_name);

  const [brandName, setBrandName] = useState<string | null>(
    brandSlug ? toTitleFromSlug(brandSlug) : null,
  );
  const [loading, setLoading] = useState<boolean>(brandId !== null);

  useEffect(() => {
    if (brandId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("brands")
          .select("name")
          .eq("id", brandId)
          .maybeSingle();
        if (cancelled) return;
        const name = (data?.name as string | null) ?? null;
        if (name && name.trim().length > 0) {
          setBrandName(name.trim());
        }
      } catch {
        // Fall through to slug-derived fallback.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const handleOpenPayments = (): void => {
    if (brandId === null) {
      router.replace("/(tabs)/home" as never);
      return;
    }
    router.replace(`/brand/${brandId}/payments` as never);
  };

  const displayName = brandName ?? brandSlug ?? "your brand";
  const partnerLine = ownerName
    ? `Hey ${ownerName} — Mingla has built it out for you.`
    : "Mingla has built it out for you.";

  return (
    <View style={styles.host}>
      <View style={styles.card}>
        <Text style={styles.hero}>🎉</Text>
        <Text style={styles.title} accessibilityRole="header">
          {loading ? "Welcome…" : `Welcome to ${displayName}`}
        </Text>
        <Text style={styles.body}>
          {partnerLine}
          {" "}
          The next step is connecting your bank so customers can buy tickets.
        </Text>
        {loading ? (
          <ActivityIndicator color={accent.warm} style={{ marginTop: 8 }} />
        ) : null}
        <Button
          label={`Set up ${displayName} on the web →`}
          onPress={handleOpenPayments}
          variant="primary"
          size="lg"
          fullWidth
        />
        <BusinessAppDownloadCta />
        <Text style={styles.footnote}>
          Or come back to your email anytime.
        </Text>
      </View>
    </View>
  );
}

function pickFirst(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toTitleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter((p) => p.length > 0)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  card: {
    maxWidth: 480,
    width: "100%",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  hero: {
    fontSize: 56,
    textAlign: "center",
    marginBottom: 4,
  },
  title: {
    ...typography.h1,
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  footnote: {
    ...typography.caption,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
