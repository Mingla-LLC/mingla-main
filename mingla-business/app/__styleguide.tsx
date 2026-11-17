/**
 * Hidden dev-only styleguide route — `/__styleguide`.
 *
 * Renders every primitive in the Mingla Host kit on a single
 * scrollable page so the founder can QA all 24 components on real
 * devices (iOS / Android / web) before Cycle 1 starts consuming the
 * kit at scale.
 *
 * Production builds redirect to `/(tabs)/home`. The route still exists
 * in the bundle but the redirect short-circuits before anything below
 * renders, so no styleguide JSX leaks to production users.
 *
 * Internal route only. It is not linked from product account navigation.
 */

import React, { useCallback, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// #1841 [keyboard-guard-blind-spots] — the styleguide renders the whole kit,
// `Input` (and therefore a real TextInput) included, inside this one scroll.
// Dev-only route, but it is the reference implementation the kit is read from,
// so it uses the canonical container. Never pass `bottomOffset` from a call
// site (I-PROPOSED-1834-…-DONE-BAR).
import { ScrollView } from "../src/wrappers/SmartScrollView";

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
  durations,
  easings,
  radius,
  space,
  color as dsColor,
  materials,
  scrim,
  shadow as dsShadow,
  type,
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
    <GlassCard variant="base" padding={space[4]} style={sectionStyles.card}>
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
          <Icon name="chevL" size={20} color={dsColor.text1} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <Text style={styles.pageTitle}>Styleguide</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        {/* ============== 1. TOKENS ============== */}
        <Section title="1. Tokens" subtitle="Colour swatches, shadows, spacing, radius">
          <Text style={sectionStyles.label}>Accent</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="warm" color={dsColor.accent} />
            <Swatch label="tint" color={dsColor.accentLine} />
            <Swatch label="border" color={dsColor.accentLine} />
            <Swatch label="glow" color={dsColor.accentLine} />
          </View>

          <Text style={sectionStyles.label}>Canvas</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="discover" color={dsColor.canvas} />
            <Swatch label="profile" color={dsColor.canvas} />
            <Swatch label="depth" color={dsColor.canvas} />
          </View>

          <Text style={sectionStyles.label}>Glass tint</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="badge.idle" color={materials.onPhoto.solidFill} />
            <Swatch label="chrome.idle" color={materials.chrome.glassFill} />
            <Swatch label="backdrop" color={scrim.ambient.colors[0]} />
            <Swatch label="profile.base" color={dsColor.fill.inset} />
            <Swatch label="profile.elev" color={dsColor.fill.tile} />
          </View>

          <Text style={sectionStyles.label}>Glass border</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="badge" color={dsColor.lineStrong} />
            <Swatch label="chrome" color={dsColor.lineStrong} />
            <Swatch label="profile.base" color={dsColor.line} />
            <Swatch label="profile.elev" color={dsColor.lineStrong} />
          </View>

          <Text style={sectionStyles.label}>Semantic</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="success" color={dsColor.success} />
            <Swatch label="warning" color={dsColor.warning} />
            <Swatch label="error" color={dsColor.danger} />
            <Swatch label="info" color={dsColor.info} />
          </View>

          <Text style={sectionStyles.label}>Text</Text>
          <View style={demoStyles.swatchRow}>
            <Swatch label="primary" color={dsColor.text1} />
            <Swatch label="secondary" color={dsColor.text2} />
            <Swatch label="tertiary" color={dsColor.text3} />
            <Swatch label="quaternary" color={dsColor.text4} />
          </View>

          <Text style={sectionStyles.label}>Shadow specimens</Text>
          <View style={demoStyles.shadowRow}>
            <ShadowSpecimen label="md" shadow={dsShadow.pane} />
            <ShadowSpecimen label="lg" shadow={dsShadow.menu} />
            <ShadowSpecimen label="xl" shadow={dsShadow.dialog} />
            <ShadowSpecimen label="glassChrome" shadow={dsShadow.liquid} />
            <ShadowSpecimen label="glassChromeActive" shadow={dsShadow.liquid} />
            <ShadowSpecimen label="glassCardBase" shadow={dsShadow.pane} />
            <ShadowSpecimen label="glassCardElevated" shadow={dsShadow.menu} />
          </View>

          <Text style={sectionStyles.label}>Spacing scale</Text>
          <View style={demoStyles.spacingRow}>
            <SpacingBar label="xxs" value={2} />
            <SpacingBar label="xs" value={space[1]} />
            <SpacingBar label="sm" value={space[2]} />
            <SpacingBar label="md" value={space[4]} />
            <SpacingBar label="lg" value={space[6]} />
            <SpacingBar label="xl" value={space[7]} />
            <SpacingBar label="xxl" value={space[9]} />
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
            blurIntensity.chrome = {materials.chrome.blur.intensity} · cardElevated = {materials.pane.blur.intensity} · modal = {materials.sheet.blur.intensity}
          </Text>
        </Section>

        {/* ============== 2. TYPOGRAPHY ============== */}
        <Section title="2. Typography" subtitle="16 type roles">
          {(Object.keys(type) as Array<keyof typeof type>).map((key) => {
            const t = type[key];
            return (
              <View key={key} style={demoStyles.typoRow}>
                <Text style={sectionStyles.rowLabel}>{key}</Text>
                <Text
                  style={{
                    fontSize: t.fontSize,
                    lineHeight: t.lineHeight,
                    fontWeight: t.fontWeight,
                    letterSpacing: t.letterSpacing,
                    color: dsColor.text1,
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
                <Icon name={name} size={22} color={dsColor.text1} />
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
            <IconChrome icon="search" accessibilityLabel="Search (demo)" />
            <IconChrome icon="bell" badge={3} accessibilityLabel="Notifications (demo, 3 unread)" />
            <IconChrome icon="bell" badge={120} accessibilityLabel="Notifications (demo, 99+ unread)" />
            <IconChrome icon="settings" active accessibilityLabel="Settings (demo, active)" />
            <IconChrome icon="settings" disabled accessibilityLabel="Settings (demo, disabled)" />
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
              <GlassCard variant="base" padding={space[4]}>
                <Text style={demoStyles.glassCardTitle}>Base</Text>
                <Text style={demoStyles.glassCardBody}>Default content card</Text>
              </GlassCard>
            </View>
            <View style={demoStyles.glassCardItem}>
              <GlassCard variant="elevated" padding={space[4]}>
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
              title="Welcome to Mingla Host"
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
              <View style={{ marginTop: space[2] }}>
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
        <View style={{ marginTop: space[4] }}>
          <Button label="Close" onPress={() => setSheetOpen(false)} variant="secondary" size="md" />
        </View>
      </Sheet>

      <Modal visible={modalOpen} onClose={() => setModalOpen(false)}>
        <Text style={demoStyles.sheetTitle}>Modal demo</Text>
        <Text style={demoStyles.sheetBody}>
          Tap the scrim or press Escape (web) to dismiss.
        </Text>
        <View style={{ marginTop: space[4], flexDirection: "row", gap: space[2], justifyContent: "flex-end" }}>
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
    backgroundColor: dsColor.canvas,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 80,
    gap: space[1],
  },
  backLabel: {
    color: dsColor.text1,
    fontSize: type.small.fontSize,
    fontWeight: "500",
  },
  pageTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: dsColor.text1,
  },
  scroll: {
    paddingHorizontal: space[4],
    paddingBottom: space[9],
    gap: space[6],
  },
  footer: {
    paddingTop: space[6],
    paddingBottom: space[6],
  },
});

const sectionStyles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: dsColor.text1,
  },
  subtitle: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: dsColor.text3,
    marginBottom: space[1],
  },
  card: {
    gap: space[2],
  },
  label: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: dsColor.text3,
    textTransform: "uppercase",
    marginTop: space[2],
  },
  note: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: dsColor.text4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    minHeight: 44,
  },
  rowLabel: {
    width: 120,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: dsColor.text3,
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
    gap: space[2],
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
    borderColor: dsColor.line,
  },
  swatchLabel: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    color: dsColor.text3,
    textAlign: "center",
  },
  shadowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[4],
    paddingVertical: space[2],
  },
  shadowItem: {
    alignItems: "center",
    gap: space[1],
  },
  shadowBox: {
    width: 56,
    height: 56,
    backgroundColor: dsColor.fill.tile,
    borderRadius: radius.md,
  },
  spacingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: space[2],
  },
  spacingItem: {
    alignItems: "center",
    gap: 2,
  },
  spacingBlock: {
    height: 24,
    backgroundColor: dsColor.accent,
    borderRadius: 2,
  },
  radiusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  radiusItem: {
    alignItems: "center",
    gap: 4,
  },
  radiusBox: {
    width: 56,
    height: 56,
    backgroundColor: dsColor.fill.tile,
    borderWidth: 1,
    borderColor: dsColor.lineStrong,
  },
  typoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    minHeight: 32,
  },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  iconCell: {
    width: 72,
    alignItems: "center",
    paddingVertical: space[1],
    gap: 4,
  },
  iconLabel: {
    fontSize: 10,
    color: dsColor.text4,
  },
  buttonGrid: {
    gap: space[2],
  },
  pulseToggle: {
    paddingVertical: space[1],
  },
  pulseToggleLabel: {
    fontSize: type.caption.fontSize,
    color: dsColor.accent,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  iconChromeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[4],
    alignItems: "center",
  },
  glassChromeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  glassChromeBox: {
    width: 140,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  glassChromeLabel: {
    color: dsColor.text1,
    fontSize: type.caption.fontSize,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
  glassCardRow: {
    flexDirection: "row",
    gap: space[2],
    flexWrap: "wrap",
  },
  glassCardItem: {
    flexBasis: 160,
    flexGrow: 1,
  },
  glassCardTitle: {
    fontSize: type.row.fontSize,
    lineHeight: type.row.lineHeight,
    fontWeight: "600",
    color: dsColor.text1,
  },
  glassCardBody: {
    fontSize: type.small.fontSize,
    color: dsColor.text2,
    marginTop: 2,
  },
  eventCoverRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  eventCoverItem: {
    width: 110,
  },
  kpiRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  kpiItem: {
    flexBasis: 160,
    flexGrow: 1,
  },
  toastTriggerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  errorBoundaryScope: {
    paddingVertical: space[2],
    gap: space[1],
  },
  errorTriggerHint: {
    fontSize: type.small.fontSize,
    color: dsColor.text2,
  },
  stepperWrap: {
    paddingVertical: space[2],
  },
  chromeWrap: {
    paddingVertical: space[2],
  },
  sheetTitle: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: dsColor.text1,
  },
  sheetBody: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: dsColor.text2,
    marginTop: space[2],
  },
});
