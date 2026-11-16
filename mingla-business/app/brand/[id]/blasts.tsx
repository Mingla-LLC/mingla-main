/**
 * /brand/[id]/blasts — Brand Blasts tab (ORCH-0815-A2-ui, renamed
 * "Customers" → "Blasts" 2026-05-12 for bottom-nav consistency).
 *
 * Surface §1 of the dual-surface Marketing Hub (DEC-149). Lists every
 * distinct buyer of the brand's events with masked contact, order count,
 * total spend, last event, and per-channel consent state. Sticky bottom
 * CTA "Blast these N customers →" launches the composer with the audience
 * pre-filled.
 *
 * Note on naming: the route + tab label say "Blasts" (the action surface).
 * In-screen counts still describe the data accurately as "customers" /
 * "buyers" — those are the underlying nouns; "Blasts" is the destination
 * verb. e.g. "412 customers · 387 reachable" + "Blast these 387 customers".
 *
 * Composer route does NOT exist yet (sub-ORCH-B builds it) — Phase A
 * shows a "Composer ships next" toast on CTA press so the path is honest
 * (Constitution #9 — no fabricated affordance; the CTA is real, the
 * downstream just isn't built yet).
 *
 * SPEC reference: SPEC §5.7. DESIGN reference: §7.7 + §8.13.
 */

import React, { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BlastCustomersCta } from "../../../src/components/marketing/BlastCustomersCta";
import { BuyerRow } from "../../../src/components/marketing/BuyerRow";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Button } from "../../../src/components/ui/Button";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
import { TopBar } from "../../../src/components/ui/TopBar";
import {
  color,
  space,
  type,
} from "../../../src/constants/designSystem";
import { useBrandCustomers } from "../../../src/hooks/marketing/useBrandCustomers";
import { useBrand } from "../../../src/hooks/useBrands";
import type {
  BlastAudienceKind,
} from "../../../src/components/marketing/BlastCustomersCta";

export default function BrandBlastsRoute(): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brandId =
    typeof idParam === "string" && idParam.length > 0 ? idParam : null;

  const brandQuery = useBrand(brandId);
  const customersQuery = useBrandCustomers(brandId);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else if (brandId !== null) router.replace(`/brand/${brandId}` as never);
  }, [router, brandId]);

  const handleBlast = useCallback(
    (kind: BlastAudienceKind, targetId: string): void => {
      // ORCH-0815-B Phase 2 — composer route is live. Navigate with the
      // audience pre-fill query param shape `{kind}:{id}` (I-PROPOSED-BU).
      router.push(
        `/marketing/campaigns/compose?audience=${kind}:${targetId}` as never,
      );
    },
    [router],
  );

  const brand = brandQuery.data ?? null;
  const customers = customersQuery.data;

  const headerCounts = useMemo(() => {
    if (customers === undefined) return null;
    const { total, reachable_email } = customers.reach;
    return `${total} ${total === 1 ? "customer" : "customers"} · ${reachable_email} reachable`;
  }, [customers]);

  // -- Loading state --
  if (customersQuery.isLoading && customers === undefined) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Blasts"
            onBack={handleBack}
            rightSlot={null}
          />
        </View>
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={color.text2} />
        </View>
      </View>
    );
  }

  // -- Error state --
  if (customersQuery.isError) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Blasts"
            onBack={handleBack}
            rightSlot={null}
          />
        </View>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="Couldn't load customers"
            description="Pull to retry, or come back in a moment."
          />
        </View>
      </View>
    );
  }

  // -- Empty state --
  if (customers !== undefined && customers.rows.length === 0) {
    return (
      <View style={[styles.host, { paddingTop: insets.top }]}>
        <View style={styles.barWrap}>
          <TopBar
            leftKind="back"
            title="Blasts"
            onBack={handleBack}
            rightSlot={null}
          />
        </View>
        <View style={styles.centerHost}>
          <EmptyState
            illustration="users"
            title="No customers yet."
            description="When people buy tickets to your events, they'll show up here."
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title={brand?.displayName ?? "Blasts"}
          onBack={handleBack}
          rightSlot={
            // #4420 — desktop puts the send action in the header (mockup);
            // phones keep the sticky bar below.
            isWideDesktop && customers !== undefined ? (
              <Button
                label={`Send blast (${customers.reach.reachable_email})`}
                variant="primary"
                size="sm"
                leadingIcon="send"
                disabled={customers.reach.reachable_email === 0}
                onPress={() => handleBlast("brand", brandId ?? "")}
                accessibilityLabel={`Send blast (${customers.reach.reachable_email})`}
              />
            ) : null
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isWideDesktop && styles.scrollContentDesktop,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* #4420 — the section label and counts sit above the pane. */}
        {headerCounts !== null ? (
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeaderLabel}>BUYERS</Text>
            <Text style={styles.cardHeaderCounts}>{headerCounts}</Text>
          </View>
        ) : null}
        <GlassCard variant="base" padding={0}>
          {customers !== undefined
            ? customers.rows.map((buyer) => (
                <BuyerRow key={buyer.contact_key} buyer={buyer} />
              ))
            : null}
        </GlassCard>
      </ScrollView>

      {customers !== undefined && !isWideDesktop ? (
        <View style={styles.ctaWrap}>
          <BlastCustomersCta
            audienceKind="brand"
            audienceTargetId={brandId ?? ""}
            reachableCount={customers.reach.reachable_email}
            onPress={handleBlast}
          />
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  // Matches the home/events/account barWrap pattern so the TopBar glass
  // capsule sits inset from screen edges with breathing space above + below
  // (NOT flush — flush reads as "zoomed-in" per operator visual review).
  barWrap: {
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[6],
  },
  // Card header inside the GlassCard wrapping the buyer list. Replaces
  // the old "bare bodyLg text floating on canvas" pattern that read as
  // orphaned per operator visual review 2026-05-12.
  cardHeader: {
    paddingHorizontal: space[1],
    paddingBottom: space[2],
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[2],
  },
  cardHeaderLabel: {
    ...type.label,
    color: color.text3,
  },
  cardHeaderCounts: {
    ...type.small,
    color: color.text2,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.fill.pressed,
  },
  scrollContent: {
    paddingHorizontal: space[4], // page margin around the GlassCard
    paddingTop: space[2],
    paddingBottom: 140, // breathe room for sticky CTA (60pt + 8pt + safe-area + buffer)
  },
  scrollContentDesktop: {
    paddingHorizontal: space[6],
    paddingBottom: space[8],
  },
  ctaWrap: {
    // CTA is glass — DO NOT set an opaque backgroundColor here. The glass
    // chrome's backdrop blur handles content-behind-glass legibility; an
    // opaque wrap would defeat the aesthetic. Safe-area inset is owned by
    // the BlastCustomersCta component itself (see its useSafeAreaInsets).
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
