/**
 * BrandPaymentsPermissionGate — the enforcement chokepoint for the payments
 * routes.
 *
 * #1863 [error-toast-covers-bank-field] §4.3.
 *
 * WHY AT THE ROUTE, NOT INSIDE THE VIEW. `BrandPaymentsView` returns early for
 * a Paystack brand, and `BrandOnboardView` returns early for its Paystack
 * branch, both BEFORE any Stripe state is consulted. A gate placed inside
 * either component after that fork would leave the whole Nigerian bank-connect
 * journey ungated. Wrapping the route puts one decision above everything, so
 * both rails are covered without a second gate — and every entry point in the
 * app (brand home, connect redirect, event/RSVP edit, paid-publish guards, the
 * bank-connect funnel, the search registry, deep links) funnels through one of
 * the three routes this wraps.
 *
 * VISIBLE-WITH-EXPLANATION, not hidden and not read-only:
 *   - hidden (redirect/404) would bounce a user who deliberately tapped
 *     Payments, usually from a to-do card, with no explanation, and would break
 *     `router.canGoBack()` expectations across three entry points;
 *   - read-only would render `—` balance tiles and empty payout lists, because
 *     the server returns NO data to these roles (both edge functions 403; the
 *     payouts/refunds RLS policies filter to zero rows). Fabricated emptiness
 *     on a money surface is Constitution rule 3, not a UX compromise.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCanManageBrandPayments } from "../../hooks/useCanManageBrandPayments";
import {
  BRAND_PAYMENTS_DENIED_BODY,
  BRAND_PAYMENTS_DENIED_TITLE,
} from "../../utils/brandPaymentsPermission";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Spinner } from "../ui/Spinner";
import { TopBar } from "../ui/TopBar";

export interface BrandPaymentsPermissionGateProps {
  brandId: string | null;
  /** TopBar title for the non-allow branches; matches the wrapped surface. */
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

export const BrandPaymentsPermissionGate: React.FC<
  BrandPaymentsPermissionGateProps
> = ({ brandId, title, onBack, children }) => {
  const { allowed, isLoading, isError, refetch } = useCanManageBrandPayments(
    brandId,
  );

  // NOT-FOUND PRECEDENCE. With no brand id there is nothing to evaluate a
  // membership against, and the wrapped view already owns the correct
  // "Brand not found" state. Rendering the denial here would confirm that a
  // brand exists to someone who cannot see it.
  if (brandId === null) return <>{children}</>;

  // ALLOW — verbatim children, no wrapper chrome, so the allowed experience is
  // byte-identical to today (SC-3).
  if (allowed) return <>{children}</>;

  const chrome = (body: React.ReactNode): React.ReactElement => (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title={title}
          onBack={onBack}
          rightSlot={<View />}
        />
      </View>
      <View style={styles.body}>{body}</View>
    </View>
  );

  // CHECKING — prevents both flashes: the full payments surface flashing before
  // the role lands, and the denial flashing at a brand owner.
  if (isLoading) {
    return chrome(
      <View style={styles.centred}>
        <Spinner size={36} />
        <Text style={styles.checkingLabel}>Checking your access…</Text>
      </View>,
    );
  }

  // UNKNOWN — default-closed must not become dishonest. A network blip must
  // never tell a brand owner they lack permission, so the controls stay hidden
  // (closed) but the message names the REAL failure and offers a real retry.
  // Telling someone to check their connection when the problem is their role is
  // the exact sin this issue exists to fix; the gate must not repeat it in the
  // other direction.
  if (isError) {
    return chrome(
      <GlassCard variant="elevated" padding={spacing.lg}>
        <Text style={styles.title} accessibilityRole="header">
          Couldn{"’"}t check your access
        </Text>
        <Text style={styles.body_}>
          We couldn{"’"}t confirm what you can do on this brand. Check your
          connection and try again.
        </Text>
        <View style={styles.btnRow}>
          <Button
            label="Try again"
            onPress={() => {
              void refetch();
            }}
            variant="secondary"
            size="md"
            accessibilityLabel="Try again"
          />
        </View>
      </GlassCard>,
    );
  }

  // DENY — the explanation card and nothing else. No controls, no money data,
  // and (because §4.2 stops both hooks from firing) no requests.
  return chrome(
    <GlassCard variant="elevated" padding={spacing.lg}>
      <Text style={styles.title} accessibilityRole="header">
        {BRAND_PAYMENTS_DENIED_TITLE}
      </Text>
      <Text style={styles.body_}>{BRAND_PAYMENTS_DENIED_BODY}</Text>
      <View style={styles.btnRow}>
        <Button
          label="Back"
          onPress={onBack}
          variant="secondary"
          size="md"
          leadingIcon="arrowL"
          accessibilityLabel="Back"
        />
      </View>
    </GlassCard>,
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  centred: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  checkingLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  body_: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  btnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
});

export default BrandPaymentsPermissionGate;
