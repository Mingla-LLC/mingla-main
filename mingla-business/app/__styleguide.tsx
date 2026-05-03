/**
 * Hidden dev-only styleguide route — `/__styleguide`.
 *
 * Renders every primitive in the Mingla Business kit on a single
 * scrollable page so the founder can QA all 24 components on real
 * devices (iOS / Android / web) before Cycle 1 starts consuming the
 * kit at scale.
 *
 * Production builds redirect to `/(tabs)/home`. The route still exists
 * in the bundle but the redirect short-circuits before anything below
 * renders, so no styleguide JSX leaks to production users.
 *
 * Entry point: dev-only "Open dev styleguide" Button on the Account
 * tab (also gated on `__DEV__`).
 */

import React, { useCallback, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionTile } from "../src/components/ui/ActionTile";
import { BottomNav } from "../src/components/ui/BottomNav";
import type { BottomNavTab } from "../src/components/ui/BottomNav";
import { Button } from "../src/components/ui/Button";
import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";
import type { ConfirmDialogVariant } from "../src/components/ui/ConfirmDialog";
import { EmptyState } from "../src/components/ui/EmptyState";
import { ErrorBoundary } from "../src/components/ui/ErrorBoundary";
import { EventCover } from "../src/components/ui/EventCover";
import { GlassCard } from "../src/components/ui/GlassCard";
import { GlassChrome } from "../src/components/ui/GlassChrome";
import { Icon } from "../src/components/ui/Icon";
import type { IconName } from "../src/components/ui/Icon";
import { IconChrome } from "../src/components/ui/IconChrome";
import { Input } from "../src/components/ui/Input";
import { KpiTile } from "../src/components/ui/KpiTile";
import { Modal } from "../src/components/ui/Modal";
import { Pill } from "../src/components/ui/Pill";
import type { PillVariant } from "../src/components/ui/Pill";
import { Sheet } from "../src/components/ui/Sheet";
import { Skeleton } from "../src/components/ui/Skeleton";
import { Spinner } from "../src/components/ui/Spinner";
import { StatusPill } from "../src/components/ui/StatusPill";
import type { StatusPillStatus } from "../src/components/ui/StatusPill";
import { Stepper } from "../src/components/ui/Stepper";
import { Toast } from "../src/components/ui/Toast";
import type { ToastKind } from "../src/components/ui/Toast";
import { TopBar } from "../src/components/ui/TopBar";
import { WebStatusBar } from "../src/components/ui/StatusBar";
import {
  accent,
  blurIntensity,
  canvas,
  durations,
  easings,
  glass,
  radius,
  semantic,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../src/constants/designSystem";
import { formatGbpRound } from "../src/utils/currency";

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, subtitle, children }) => (
  <View style={sectionStyles.section}>
    <Text style={sectionStyles.title}>{title}</Text>
    {subtitle !== undefined ? (
      <Text style={sectionStyles.subtitle}>{subtitle}</Text>
    ) : null}
    <GlassCard variant="base" padding={spacing.md} style={sectionStyles.card}>
      {children}
    </GlassCard>
  </View>
);

interface SectionRowProps {
  label: string;
  children: React.ReactNode;
}

const SectionRow: React.FC<SectionRowProps> = ({ label, children }) => (
  <View style={sectionStyles.row}>
    <Text style={sectionStyles.rowLabel}>{label}</Text>
    <View style={sectionStyles.rowContent}>{children}</View>
  </View>
);

// ---------------------------------------------------------------------------
// Icon name list — used for the icon-grid section
// ---------------------------------------------------------------------------

const ALL_ICON_NAMES: readonly IconName[] = [
  "home", "calendar", "chat", "user", "plus",
  "chevR", "chevL", "chevD", "chevU", "close",
  "check", "search", "bell", "qr", "scan",
  "share", "edit", "pound", "trash", "settings",
  "google", "apple", "arrowL", "moreH", "flash",
  "location", "clock", "ticket", "eye", "cash",
  "tap", "list", "grid", "refund", "sparkle",
  "flag", "flashOn", "keypad", "backspace", "star",
  "mail", "sms", "chart", "pieChart", "funnel",
  "link", "users", "tag", "send", "play",
  "pause", "template", "upload", "download", "filter",
  "branch", "shield", "receipt", "bank", "nfc",
  "swap", "target", "calendarPlus", "globe", "rocket",
  "notebook", "award", "trending", "inbox",
];

const PILL_VARIANTS: readonly PillVariant[] = [
  "live", "draft", "warn", "accent", "error", "info",
];

const STATUS_PILL_STATES: readonly StatusPillStatus[] = [
  "LIVE", "DRAFT", "UPCOMING", "ENDED", "PENDING", "PREVIEW", "SOLD_OUT",
];

const CONFIRM_DIALOG_VARIANTS: readonly ConfirmDialogVariant[] = [
  "simple", "typeToConfirm", "holdToConfirm",
];

const STYLEGUIDE_TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "events", icon: "calendar", label: "Events" },
  { id: "account", icon: "user", label: "Account" },
];

// ---------------------------------------------------------------------------
// Error-throwing helper (for ErrorBoundary demo)
// ---------------------------------------------------------------------------

const ErrorTrigger: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error("Styleguide ErrorBoundary demo — this is intentional.");
  }
  return (
    <Text style={demoStyles.errorTriggerHint}>
      ErrorBoundary scope is healthy. Tap below to throw.
    </Text>
  );
};

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function StyleguideScreen(): React.ReactElement {
  if (!__DEV__) {
    return <Redirect href="/(tabs)/home" />;
  }

  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Trigger demo state
  const [toastKind, setToastKind] = useState<ToastKind | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmVariant, setConfirmVariant] = useState<ConfirmDialogVariant | null>(null);
  const [errorThrow, setErrorThrow] = useState(false);
  const [pillPulseOn, setPillPulseOn] = useState(true);
  const [navActive, setNavActive] = useState<string>("home");
  const [searchValue, setSearchValue] = useState("");

  const handleErrorReset = useCallback((): void => {
    setErrorThrow(false);
  }, []);

  const handleSampleButtonPress = useCallback((): void => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[Styleguide] Sample Button pressed — verify haptic on real device.");
    }
  }, []);

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to Account"
        >
          <Icon name="chevL" size={20} color={textTokens.primary} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <Text style={styles.pageTitle}>Styleguide</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator>
        {/* ============== 1. TOKENS ============== */}
        <Section title="1. Tokens" subtitle="Colour swatches, shadows, spacing, radius">
          <Text style={sectionStyles.label}>Accent</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="warm" color={accent.warm} />
            <Swatch label="tint" color={accent.tint} />
            <Swatch label="border" color={accent.border} />
            <Swatch label="glow" color={accent.glow} />
          </View>

          <Text style={sectionStyles.label}>Canvas</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="discover" color={canvas.discover} />
            <Swatch label="profile" color={canvas.profile} />
            <Swatch label="depth" color={canvas.depth} />
          </View>

          <Text style={sectionStyles.label}>Glass tint</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="badge.idle" color={glass.tint.badge.idle} />
            <Swatch label="chrome.idle" color={glass.tint.chrome.idle} />
            <Swatch label="backdrop" color={glass.tint.backdrop} />
            <Swatch label="profile.base" color={glass.tint.profileBase} />
            <Swatch label="profile.elev" color={glass.tint.profileElevated} />
          </View>

          <Text style={sectionStyles.label}>Glass border</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="badge" color={glass.border.badge} />
            <Swatch label="chrome" color={glass.border.chrome} />
            <Swatch label="profile.base" color={glass.border.profileBase} />
            <Swatch label="profile.elev" color={glass.border.profileElevated} />
          </View>

          <Text style={sectionStyles.label}>Semantic</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="success" color={semantic.success} />
            <Swatch label="warning" color={semantic.warning} />
            <Swatch label="error" color={semantic.error} />
            <Swatch label="info" color={semantic.info} />
          </View>

          <Text style={sectionStyles.label}>Text</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="primary" color={textTokens.primary} />
            <Swatch label="secondary" color={textTokens.secondary} />
            <Swatch label="tertiary" color={textTokens.tertiary} />
            <Swatch label="quaternary" color={textTokens.quaternary} />
          </View>

          <Text style={sectionStyles.label}>Shadow specimens</Text>
          <View style={demoStyles.shadowRow}>
            <ShadowSpecimen label="md" shadow={shadows.md} />
            <ShadowSpecimen label="lg" shadow={shadows.lg} />
            <ShadowSpecimen label="xl" shadow={shadows.xl} />
            <ShadowSpecimen label="glassChrome" shadow={shadows.glassChrome} />
            <ShadowSpecimen label="glassChromeActive" shadow={shadows.glassChromeActive} />
            <ShadowSpecimen label="glassCardBase" shadow={shadows.glassCardBase} />
            <ShadowSpecimen label="glassCardElevated" shadow={shadows.glassCardElevated} />
          </View>

          <Text style={sectionStyles.label}>Spacing scale</Text>
          <View style={demoStyles.spacingRow}>
            <SpacingBar label="xxs" value={spacing.xxs} />
            <SpacingBar label="xs" value={spacing.xs} />
            <SpacingBar label="sm" value={spacing.sm} />
            <SpacingBar label="md" value={spacing.md} />
            <SpacingBar label="lg" value={spacing.lg} />
            <SpacingBar label="xl" value={spacing.xl} />
            <SpacingBar label="xxl" value={spacing.xxl} />
          </View>

          <Text style={sectionStyles.label}>Radius scale</Text>
          <View style={demoStyles.radiusRow}>
            <RadiusSpecimen label="sm" value={radius.sm} />
            <RadiusSpecimen label="md" value={radius.md} />
            <RadiusSpecimen label="lg" value={radius.lg} />
            <RadiusSpecimen label="xl" value={radius.xl} />
            <RadiusSpecimen label="xxl" value={radius.xxl} />
          </View>

          <Text style={sectionStyles.label}>Motion tokens</Text>
          <Text style={sectionStyles.note}>
            durations.fast = {durations.fast}ms · easings.press is the standard press curve.
          </Text>
          <Text style={sectionStyles.note}>
            blurIntensity.chrome = {blurIntensity.chrome} · cardElevated = {blurIntensity.cardElevated} · modal = {blurIntensity.modal}
          </Text>
        </Section>

        {/* ============== 2. TYPOGRAPHY ============== */}
        <Section title="2. Typography" subtitle="14 type roles">
          {(Object.keys(typography) as Array<keyof typeof typography>).map((key) => {
            const t = typography[key];
            return (
              <View key={key} style={demoStyles.typoRow}>
                <Text style={sectionStyles.rowLabel}>{key}</Text>
                <Text
                  style={{
                    fontSize: t.fontSize,
                    lineHeight: t.lineHeight,
                    fontWeight: t.fontWeight,
                    letterSpacing: t.letterSpacing,
                    color: textTokens.primary,
                  }}
                >
                  Live event tonight
                </Text>
              </View>
            );
          })}
        </Section>

        {/* ============== 3. ATOMS ============== */}
        <Section title="3. Atoms" subtitle="Spinner · Skeleton · StatusBar">
          <SectionRow label="Spinner 24">
            <Spinner size={24} />
          </SectionRow>
          <SectionRow label="Spinner 36">
            <Spinner size={36} />
          </SectionRow>
          <SectionRow label="Spinner 48">
            <Spinner size={48} />
          </SectionRow>
          <SectionRow label="Skeleton 100% × 16">
            <Skeleton width="100%" height={16} radius="md" />
          </SectionRow>
          <SectionRow label="Skeleton 60% × 24">
            <Skeleton width="60%" height={24} radius="md" />
          </SectionRow>
          <SectionRow label="Skeleton 100% × 80">
            <Skeleton width="100%" height={80} radius="lg" />
          </SectionRow>
          {Platform.OS === "web" ? (
            <SectionRow label="WebStatusBar (web only)">
              <WebStatusBar />
            </SectionRow>
          ) : (
            <Text style={sectionStyles.note}>
              NativeStatusBar is rendered globally on iOS / Android via expo-status-bar — visible at the top of the screen. WebStatusBar shows on web only.
            </Text>
          )}
        </Section>

        {/* ============== 4. ICON GLYPHS ============== */}
        <Section title="4. Icon glyphs" subtitle={`All ${ALL_ICON_NAMES.length} IconName values @ size 22`}>
          <View style={demoStyles.iconGrid}>
            {ALL_ICON_NAMES.map((name) => (
              <View key={name} style={demoStyles.iconCell}>
                <Icon name={name} size={22} color={textTokens.primary} />
                <Text style={demoStyles.iconLabel}>{name}</Text>
              </View>
            ))}
          </View>
        </Section>

        {/* ============== 5. FORM & DISPLAY ============== */}
        <Section title="5. Form & display" subtitle="Buttons · Pills · StatusPills · Inputs">
          <Text style={sectionStyles.label}>Buttons (4 variants × 3 sizes — idle state)</Text>
          <Text style={sectionStyles.note}>
            Hover/focus/press/disabled require interaction — tap "Sample press" below to test haptics on a real device.
          </Text>
          <View style={demoStyles.buttonGrid}>
            <SectionRow label="primary · sm">
              <Button label="Save event" onPress={() => {}} variant="primary" size="sm" />
            </SectionRow>
            <SectionRow label="primary · md">
              <Button label="Save event" onPress={() => {}} variant="primary" size="md" />
            </SectionRow>
            <SectionRow label="primary · lg">
              <Button label="Save event" onPress={() => {}} variant="primary" size="lg" />
            </SectionRow>
            <SectionRow label="secondary · md">
              <Button label="Cancel" onPress={() => {}} variant="secondary" size="md" />
            </SectionRow>
            <SectionRow label="ghost · md">
              <Button label="Learn more" onPress={() => {}} variant="ghost" size="md" />
            </SectionRow>
            <SectionRow label="destructive · md">
              <Button label="Delete event" onPress={() => {}} variant="destructive" size="md" />
            </SectionRow>
            <SectionRow label="primary · md · loading">
              <Button label="Saving" onPress={() => {}} variant="primary" size="md" loading />
            </SectionRow>
            <SectionRow label="primary · md · disabled">
              <Button label="Save event" onPress={() => {}} variant="primary" size="md" disabled />
            </SectionRow>
            <SectionRow label="primary · md · with leading icon">
              <Button label="Add brand" onPress={() => {}} variant="primary" size="md" leadingIcon="plus" />
            </SectionRow>
            <SectionRow label="square shape">
              <Button label="Refund" onPress={() => {}} variant="secondary" size="md" shape="square" />
            </SectionRow>
            <SectionRow label="Sample press (haptic)">
              <Button label="Sample press" onPress={handleSampleButtonPress} variant="primary" size="md" />
            </SectionRow>
          </View>

          <Text style={sectionStyles.label}>Pills (6 variants)</Text>
          <Pressable
            onPress={() => setPillPulseOn((p) => !p)}
            style={demoStyles.pulseToggle}
            accessibilityRole="button"
            accessibilityLabel={pillPulseOn ? "Stop livePulse" : "Start livePulse"}
          >
            <Text style={demoStyles.pulseToggleLabel}>
              livePulse: {pillPulseOn ? "ON" : "OFF"} (tap to toggle)
            </Text>
          </Pressable>
          <View style={demoStyles.pillRow}>
            {PILL_VARIANTS.map((variant) => (
              <Pill key={variant} variant={variant} livePulse={variant === "live" && pillPulseOn}>
                {variant}
              </Pill>
            ))}
          </View>

          <Text style={sectionStyles.label}>StatusPills (7 statuses)</Text>
          <View style={demoStyles.pillRow}>
            {STATUS_PILL_STATES.map((status) => (
              <StatusPill key={status} status={status} />
            ))}
          </View>

          <Text style={sectionStyles.label}>Inputs (6 variants)</Text>
          <SectionRow label="text · empty">
            <Input value="" onChangeText={() => {}} variant="text" placeholder="Event title" />
          </SectionRow>
          <SectionRow label="text · filled">
            <Input value="Lonely Moth Live" onChangeText={() => {}} variant="text" />
          </SectionRow>
          <SectionRow label="email">
            <Input value="" onChangeText={() => {}} variant="email" placeholder="you@brand.com" />
          </SectionRow>
          <SectionRow label="phone">
            <Input value="" onChangeText={() => {}} variant="phone" placeholder="7700 900000" />
          </SectionRow>
          <SectionRow label="number">
            <Input value="" onChangeText={() => {}} variant="number" placeholder="120" />
          </SectionRow>
          <SectionRow label="password">
            <Input value="" onChangeText={() => {}} variant="password" placeholder="••••••" />
          </SectionRow>
          <SectionRow label="search · clearable · live">
            <Input
              value={searchValue}
              onChangeText={setSearchValue}
              variant="search"
              placeholder="Search events"
              clearable
            />
          </SectionRow>
          <SectionRow label="text · with leading icon">
            <Input value="" onChangeText={() => {}} variant="text" placeholder="Brand name" leadingIcon="tag" />
          </SectionRow>
          <SectionRow label="text · disabled">
            <Input value="Read only" onChangeText={() => {}} variant="text" disabled />
          </SectionRow>
        </Section>

        {/* ============== 6. GLASS SURFACES ============== */}
        <Section title="6. Glass surfaces" subtitle="IconChrome · GlassChrome · GlassCard · EventCover">
          <Text style={sectionStyles.label}>IconChrome variants</Text>
          <View style={demoStyles.iconChromeRow}>
            <IconChrome icon="search" />
            <IconChrome icon="bell" badge={3} />
            <IconChrome icon="bell" badge={120} />
            <IconChrome icon="settings" active />
            <IconChrome icon="settings" disabled />
          </View>

          <Text style={sectionStyles.label}>GlassChrome intensity comparison</Text>
          <View style={demoStyles.glassChromeRow}>
            <GlassChrome intensity="chrome" radius="lg" style={demoStyles.glassChromeBox}>
              <Text style={demoStyles.glassChromeLabel}>chrome (28)</Text>
            </GlassChrome>
            <GlassChrome intensity="cardBase" radius="lg" style={demoStyles.glassChromeBox}>
              <Text style={demoStyles.glassChromeLabel}>cardBase (30)</Text>
            </GlassChrome>
            <GlassChrome intensity="cardElevated" radius="lg" style={demoStyles.glassChromeBox}>
              <Text style={demoStyles.glassChromeLabel}>cardElevated (34)</Text>
            </GlassChrome>
            <GlassChrome intensity="modal" radius="lg" style={demoStyles.glassChromeBox}>
              <Text style={demoStyles.glassChromeLabel}>modal (40)</Text>
            </GlassChrome>
          </View>

          <Text style={sectionStyles.label}>GlassCard variants</Text>
          <View style={demoStyles.glassCardRow}>
            <View style={demoStyles.glassCardItem}>
              <GlassCard variant="base" padding={spacing.md}>
                <Text style={demoStyles.glassCardTitle}>Base</Text>
                <Text style={demoStyles.glassCardBody}>Default content card</Text>
              </GlassCard>
            </View>
            <View style={demoStyles.glassCardItem}>
              <GlassCard variant="elevated" padding={spacing.md}>
                <Text style={demoStyles.glassCardTitle}>Elevated</Text>
                <Text style={demoStyles.glassCardBody}>Lifted content card</Text>
              </GlassCard>
            </View>
          </View>

          <Text style={sectionStyles.label}>EventCover (hue range)</Text>
          <View style={demoStyles.eventCoverRow}>
            {[0, 25, 80, 200, 320].map((hue) => (
              <View key={hue} style={demoStyles.eventCoverItem}>
                <EventCover hue={hue} radius={12} height={80} label={`hue ${hue}`} />
              </View>
            ))}
          </View>
        </Section>

        {/* ============== 7. COMPOSITIONS ============== */}
        <Section title="7. Compositions" subtitle="KpiTile · ActionTile · EmptyState">
          <Text style={sectionStyles.label}>KpiTile (delta states)</Text>
          <View style={demoStyles.kpiRow}>
            <View style={demoStyles.kpiItem}>
              <KpiTile label="Tickets sold" value={formatGbpRound(3420)} delta="+12%" deltaUp sub="vs last week" />
            </View>
            <View style={demoStyles.kpiItem}>
              <KpiTile label="Refunds" value={formatGbpRound(95)} delta="-3%" deltaUp={false} sub="vs last week" />
            </View>
            <View style={demoStyles.kpiItem}>
              <KpiTile label="Attendees" value={482} delta="—" />
            </View>
          </View>

          <Text style={sectionStyles.label}>ActionTile</Text>
          <SectionRow label="default">
            <ActionTile
              icon="calendarPlus"
              label="Create event"
              sub="Pick a date and start"
              onPress={() => {}}
            />
          </SectionRow>
          <SectionRow label="primary">
            <ActionTile
              icon="rocket"
              label="Launch campaign"
              sub="Push to followers"
              onPress={() => {}}
              primary
            />
          </SectionRow>

          <Text style={sectionStyles.label}>EmptyState</Text>
          <SectionRow label="icon illustration">
            <EmptyState
              illustration="calendar"
              title="No events yet"
              description="Add your first event to get started."
              cta={{ label: "Create event", onPress: () => {} }}
            />
          </SectionRow>
          <SectionRow label="no illustration">
            <EmptyState
              title="Welcome to Mingla Business"
              description="Spin up a brand to begin."
            />
          </SectionRow>
          <SectionRow label="no CTA">
            <EmptyState
              illustration="inbox"
              title="No notifications"
              description="You're all caught up."
            />
          </SectionRow>
        </Section>

        {/* ============== 8. OVERLAYS ============== */}
        <Section title="8. Overlays" subtitle="Toast · Sheet · Modal · ConfirmDialog · ErrorBoundary">
          <Text style={sectionStyles.label}>Toast (4 kinds — auto-dismiss per kind)</Text>
          <View style={demoStyles.toastTriggerRow}>
            <Button label="Success" onPress={() => setToastKind("success")} variant="secondary" size="sm" />
            <Button label="Info" onPress={() => setToastKind("info")} variant="secondary" size="sm" />
            <Button label="Warn" onPress={() => setToastKind("warn")} variant="secondary" size="sm" />
            <Button label="Error" onPress={() => setToastKind("error")} variant="secondary" size="sm" />
          </View>

          <Text style={sectionStyles.label}>Sheet</Text>
          <SectionRow label="open Sheet">
            <Button label="Open bottom sheet" onPress={() => setSheetOpen(true)} variant="secondary" size="md" />
          </SectionRow>

          <Text style={sectionStyles.label}>Modal</Text>
          <SectionRow label="open Modal">
            <Button label="Open centred modal" onPress={() => setModalOpen(true)} variant="secondary" size="md" />
          </SectionRow>

          <Text style={sectionStyles.label}>ConfirmDialog (3 variants)</Text>
          <View style={demoStyles.toastTriggerRow}>
            <Button label="Simple" onPress={() => setConfirmVariant("simple")} variant="secondary" size="sm" />
            <Button label="Type to confirm" onPress={() => setConfirmVariant("typeToConfirm")} variant="secondary" size="sm" />
            <Button label="Hold to confirm" onPress={() => setConfirmVariant("holdToConfirm")} variant="secondary" size="sm" />
          </View>

          <Text style={sectionStyles.label}>ErrorBoundary</Text>
          <Text style={sectionStyles.note}>
            Tap "Throw" to render the fallback panel. The "Try again" button inside the fallback resets state.
          </Text>
          <ErrorBoundary onReset={handleErrorReset}>
            <View style={demoStyles.errorBoundaryScope}>
              <ErrorTrigger shouldThrow={errorThrow} />
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  label="Throw inside ErrorBoundary"
                  onPress={() => setErrorThrow(true)}
                  variant="destructive"
                  size="sm"
                />
              </View>
            </View>
          </ErrorBoundary>
        </Section>

        {/* ============== 9. INDICATOR ============== */}
        <Section title="9. Indicator" subtitle="Stepper (mobile dots / web circles)">
          <Text style={sectionStyles.label}>Stepper at index 0</Text>
          <View style={demoStyles.stepperWrap}>
            <Stepper
              steps={[
                { id: "basics", label: "Basics" },
                { id: "when", label: "When" },
                { id: "where", label: "Where" },
                { id: "tickets", label: "Tickets" },
              ]}
              currentIndex={0}
            />
          </View>

          <Text style={sectionStyles.label}>Stepper at index 2</Text>
          <View style={demoStyles.stepperWrap}>
            <Stepper
              steps={[
                { id: "basics", label: "Basics" },
                { id: "when", label: "When" },
                { id: "where", label: "Where" },
                { id: "tickets", label: "Tickets" },
              ]}
              currentIndex={2}
            />
          </View>

          <Text style={sectionStyles.label}>Stepper at last index</Text>
          <View style={demoStyles.stepperWrap}>
            <Stepper
              steps={[
                { id: "basics", label: "Basics" },
                { id: "when", label: "When" },
                { id: "where", label: "Where" },
                { id: "tickets", label: "Tickets" },
              ]}
              currentIndex={3}
            />
          </View>
        </Section>

        {/* ============== 10. CHROME ============== */}
        <Section title="10. Chrome" subtitle="TopBar · BottomNav (active tab spotlight animates on change)">
          <Text style={sectionStyles.label}>TopBar leftKind="brand"</Text>
          <View style={demoStyles.chromeWrap}>
            <TopBar leftKind="brand" />
          </View>

          <Text style={sectionStyles.label}>TopBar leftKind="back"</Text>
          <View style={demoStyles.chromeWrap}>
            <TopBar leftKind="back" title="Event details" onBack={() => {}} />
          </View>

          <Text style={sectionStyles.label}>TopBar leftKind="none"</Text>
          <View style={demoStyles.chromeWrap}>
            <TopBar leftKind="none" />
          </View>

          <Text style={sectionStyles.label}>BottomNav (tap a tab to see spotlight animate)</Text>
          <View style={demoStyles.chromeWrap}>
            <BottomNav tabs={STYLEGUIDE_TABS} active={navActive} onChange={setNavActive} />
          </View>
        </Section>

        <View style={styles.footer}>
          <Text style={sectionStyles.note}>
            End of styleguide. Platform: {Platform.OS}. If anything looks broken, capture the section name + describe what's off.
          </Text>
        </View>
      </ScrollView>

      {/* ============== Trigger overlays ============== */}
      <Toast
        visible={toastKind !== null}
        kind={toastKind ?? "info"}
        message={
          toastKind === "success" ? "Event saved." :
          toastKind === "warn"    ? "Doors open in 30 minutes." :
          toastKind === "error"   ? "Couldn't reach the venue. Tap to retry." :
                                    "Tickets are now on sale."
        }
        onDismiss={() => setToastKind(null)}
      />

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} snapPoint="half">
        <Text style={demoStyles.sheetTitle}>Sheet demo</Text>
        <Text style={demoStyles.sheetBody}>
          Drag the handle down past 80px to dismiss, or tap the scrim. Spring open
          uses (damping 22, stiffness 200, mass 1.0) per dispatch.
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Button label="Close" onPress={() => setSheetOpen(false)} variant="secondary" size="md" />
        </View>
      </Sheet>

      <Modal visible={modalOpen} onClose={() => setModalOpen(false)}>
        <Text style={demoStyles.sheetTitle}>Modal demo</Text>
        <Text style={demoStyles.sheetBody}>
          Tap the scrim or press Escape (web) to dismiss.
        </Text>
        <View style={{ marginTop: spacing.md, flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" }}>
          <Button label="Close" onPress={() => setModalOpen(false)} variant="primary" size="md" />
        </View>
      </Modal>

      {confirmVariant !== null ? (
        <ConfirmDialog
          visible={true}
          onClose={() => setConfirmVariant(null)}
          onConfirm={() => {
            setConfirmVariant(null);
          }}
          title={
            confirmVariant === "simple" ? "Cancel event?" :
            confirmVariant === "typeToConfirm" ? "Delete brand permanently?" :
            "End the live event?"
          }
          description={
            confirmVariant === "simple" ? "Attendees will be notified by email." :
            confirmVariant === "typeToConfirm" ? "Type your brand name to confirm." :
            "Hold to end. Doors close immediately."
          }
          variant={confirmVariant}
          confirmText={confirmVariant === "typeToConfirm" ? "Lonely Moth" : undefined}
          confirmLabel={confirmVariant === "holdToConfirm" ? "End event" : "Confirm"}
          destructive={confirmVariant !== "simple"}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inline demo helpers (kept inside the file per dispatch §3.1)
// ---------------------------------------------------------------------------

interface SwatchProps {
  label: string;
  color: string;
}

const Swatch: React.FC<SwatchProps> = ({ label, color }) => (
  <View style={demoStyles.swatch}>
    <View style={[demoStyles.swatchChip, { backgroundColor: color }]} />
    <Text style={demoStyles.swatchLabel} numberOfLines={1}>{label}</Text>
  </View>
);

interface ShadowSpecimenProps {
  label: string;
  shadow: object;
}

const ShadowSpecimen: React.FC<ShadowSpecimenProps> = ({ label, shadow }) => (
  <View style={demoStyles.shadowItem}>
    <View style={[demoStyles.shadowBox, shadow]} />
    <Text style={demoStyles.swatchLabel} numberOfLines={1}>{label}</Text>
  </View>
);

interface SpacingBarProps {
  label: string;
  value: number;
}

const SpacingBar: React.FC<SpacingBarProps> = ({ label, value }) => (
  <View style={demoStyles.spacingItem}>
    <View style={[demoStyles.spacingBlock, { width: value }]} />
    <Text style={demoStyles.swatchLabel}>{label} ({value}px)</Text>
  </View>
);

interface RadiusSpecimenProps {
  label: string;
  value: number;
}

const RadiusSpecimen: React.FC<RadiusSpecimenProps> = ({ label, value }) => (
  <View style={demoStyles.radiusItem}>
    <View style={[demoStyles.radiusBox, { borderRadius: value }]} />
    <Text style={demoStyles.swatchLabel}>{label} ({value}px)</Text>
  </View>
);

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

void easings; // referenced in token doc text — keep import live for IDE intellisense

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 80,
    gap: spacing.xs,
  },
  backLabel: {
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
  },
  pageTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  footer: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
});

const sectionStyles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
  },
  subtitle: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  card: {
    gap: spacing.sm,
  },
  label: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    marginTop: spacing.sm,
  },
  note: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.quaternary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
  },
  rowLabel: {
    width: 120,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  rowContent: {
    flex: 1,
    flexShrink: 1,
  },
});

const demoStyles = StyleSheet.create({
  swatchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  swatch: {
    width: 88,
    alignItems: "center",
    gap: 4,
  },
  swatchChip: {
    width: 64,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  swatchLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  shadowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  shadowItem: {
    alignItems: "center",
    gap: spacing.xs,
  },
  shadowBox: {
    width: 56,
    height: 56,
    backgroundColor: glass.tint.profileElevated,
    borderRadius: radius.md,
  },
  spacingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  spacingItem: {
    alignItems: "center",
    gap: 2,
  },
  spacingBlock: {
    height: 24,
    backgroundColor: accent.warm,
    borderRadius: 2,
  },
  radiusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  radiusItem: {
    alignItems: "center",
    gap: 4,
  },
  radiusBox: {
    width: 56,
    height: 56,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  typoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 32,
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  iconCell: {
    width: 72,
    alignItems: "center",
    paddingVertical: spacing.xs,
    gap: 4,
  },
  iconLabel: {
    fontSize: 10,
    color: textTokens.quaternary,
  },
  buttonGrid: {
    gap: spacing.sm,
  },
  pulseToggle: {
    paddingVertical: spacing.xs,
  },
  pulseToggleLabel: {
    fontSize: typography.caption.fontSize,
    color: accent.warm,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  iconChromeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    alignItems: "center",
  },
  glassChromeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  glassChromeBox: {
    width: 140,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  glassChromeLabel: {
    color: textTokens.primary,
    fontSize: typography.caption.fontSize,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  glassCardRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  glassCardItem: {
    flexBasis: 160,
    flexGrow: 1,
  },
  glassCardTitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  glassCardBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginTop: spacing.xxs,
  },
  eventCoverRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  eventCoverItem: {
    width: 110,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  kpiItem: {
    flexBasis: 160,
    flexGrow: 1,
  },
  toastTriggerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  errorBoundaryScope: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  errorTriggerHint: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  stepperWrap: {
    paddingVertical: spacing.sm,
  },
  chromeWrap: {
    paddingVertical: spacing.sm,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  sheetBody: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.sm,
  },
});
