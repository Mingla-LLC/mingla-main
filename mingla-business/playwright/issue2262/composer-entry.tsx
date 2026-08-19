/**
 * #2262 [composer-responsive-layout] — the browser-harness entry point.
 *
 * # REWORKED after the tester's P2-1
 *
 * The first version of this file hand-wrote the composer tree and **never
 * imported `ComposerCanvas`** — the one file that wraps the whole column in a
 * `ScrollView` on any browser narrower than 1024px. It also typed a one-line
 * draft, faked `SmsComposeCard` with a two-line stub, and substituted the
 * Personalize panel with a fixed 212px spacer mounted as a SIBLING of the sheet
 * rather than opening the real panel inside the toolbar.
 *
 * The consequence was the exact bug class this whole issue exists to end: the
 * suite reported **64/64 green against a build that pushed the commit bar
 * 3183px off screen** at 320x568 with a 32-paragraph draft. A check that cannot
 * fail for the property it claims to guard carries no information.
 *
 * So this version:
 *   - mounts the **real `ComposerCanvas`** (Metro/esbuild resolve `.web.tsx`),
 *     so the narrow-web branch and the desktop 60/40 pane split are the shipped
 *     ones, not a reconstruction;
 *   - mounts the **real `SmsComposeCard`**, so SC-2-Web-D's dead-gap claim is
 *     measured against the real card and not a two-line fake;
 *   - **parameterises draft length** (`?paras=N`), because both the defect and
 *     the fix hinge on content height and nothing anywhere varied it;
 *   - drives the **real Personalize panel** by clicking the real pill, instead
 *     of spacering a number in beside the sheet;
 *   - renders the **real scrim** — `expo-linear-gradient` is no longer stubbed,
 *     because the old passthrough stub forwarded children and dropped `style`,
 *     so the 24pt band measured 0 and every reported number was 24px optimistic.
 *
 * The route TopBar's 64pt (56 + 8) is still rendered as a real spacer: it is the
 * single largest miss in RC-1 and a harness without it would flatter the fix.
 */

import React from "react";

// `@types/react-dom` is not installed and package manifests are do-not-touch,
// so a real `import` would add a TS7016 to the repo-wide diagnostic baseline.
interface ReactDomClient {
  createRoot: (container: Element) => { render: (node: React.ReactNode) => void };
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRoot } = require("react-dom/client") as ReactDomClient;

import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChannelTabs } from "../../src/components/marketing/ChannelTabs";
import type { MarketingChannelKind } from "../../src/components/marketing/ChannelTabs";
import { ComposerHeader } from "../../src/components/marketing/ComposerHeader";
import { ComposerStepWho } from "../../src/components/marketing/ComposerStepWho";
import { SmsComposeCard } from "../../src/components/marketing/SmsComposeCard";
import {
  ComposerCommitBar,
  ComposerCommitScrim,
} from "../../src/components/marketing/ComposerCommitBar";
// THE FILE THE FIRST HARNESS LEFT OUT. Below 1024px this used to wrap the whole
// column — commit bar included — in a ScrollView, which is what let the bar
// travel without bound.
import { ComposerCanvas } from "../../src/components/marketing/ComposerV2/ComposerCanvas";
// #2262 — the SCHEDULE PATH. The chip is now the ONLY route to scheduling (the
// old peer "Schedule" button is gone), so if the picker does not appear the
// feature is unreachable on this surface. Mounted here exactly as `compose.tsx`
// mounts it — inside the keyboard host, per the sub-sheet rule.
import { SchedulePickerSheet } from "../../src/components/marketing/ComposerV2/SchedulePickerSheet";
import { ComposerV2Editor } from "../../src/components/marketing/ComposerV2/ComposerV2Editor";
import { canvas, spacing } from "../../src/constants/designSystem";
import { useResponsiveLayout } from "../../src/hooks/useResponsiveLayout";

interface HarnessFlags {
  channel: MarketingChannelKind;
  /** Draft length in paragraphs. THE axis the first harness never varied. */
  paras: number;
  /** Renders the blocked-reason caption — the bar's tallest resting state. */
  blocked: boolean;
  /** Starts in scheduled mode so the chip and the `Schedule` label are exercised. */
  scheduled: boolean;
}

function readFlags(): HarnessFlags {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  const paras = Number.parseInt(q.get("paras") ?? "1", 10);
  return {
    channel: q.get("channel") === "sms" ? "sms" : "email",
    paras: Number.isFinite(paras) && paras > 0 ? paras : 1,
    blocked: q.get("blocked") === "1",
    scheduled: q.get("mode") === "scheduled",
  };
}

/** A real draft, at the requested length. Long words so it cannot collapse. */
function buildDraft(paras: number): string {
  const sentence =
    "We are opening the rooftop again this Friday and there is room for everyone " +
    "who wants to come along for the evening, so bring the people you like most.";
  return Array.from({ length: paras }, (_, i) => `<p>${i + 1}. ${sentence}</p>`).join("");
}

function buildSmsBody(paras: number): string {
  const sentence =
    "We are opening the rooftop again this Friday and there is room for everyone.";
  return Array.from({ length: paras }, (_, i) => `${i + 1}. ${sentence}`).join("\n\n");
}

const noop = (): void => undefined;

function Harness(): React.ReactElement {
  const flags = React.useMemo(readFlags, []);
  const { isWideDesktop, isShort } = useResponsiveLayout();
  const [subject, setSubject] = React.useState("Weekend at the rooftop");
  const initialBody = React.useMemo(() => buildDraft(flags.paras), [flags.paras]);
  const [body, setBody] = React.useState(initialBody);
  const [smsBody, setSmsBody] = React.useState(() => buildSmsBody(flags.paras));
  const [mode, setMode] = React.useState<"now" | "scheduled">(
    flags.scheduled ? "scheduled" : "now",
  );
  const [channel, setChannel] = React.useState<MarketingChannelKind>(flags.channel);
  const [showSchedulePicker, setShowSchedulePicker] = React.useState(false);
  const [scheduledForIso, setScheduledForIso] = React.useState("");
  const [showReview, setShowReview] = React.useState(false);

  // Mirrors `compose.tsx`'s SchedulePickerSheet.onContinue verbatim, including
  // the 350ms defer (iOS will not present a second Modal while the first is
  // mid-dismiss) and the ORDER that amendment 10.4 depends on: the mode and the
  // ISO are set BEFORE the review sheet opens, so dismissing the review leaves
  // them intact and the chip still reads the chosen time.
  const onPickerContinue = React.useCallback((iso: string): void => {
    setMode("scheduled");
    setScheduledForIso(iso);
    setShowSchedulePicker(false);
    setTimeout(() => setShowReview(true), 350);
  }, []);

  const scheduledShortLabel =
    mode === "scheduled" && scheduledForIso.length > 0
      ? new Date(scheduledForIso).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : mode === "scheduled"
        ? "Thu 10:00"
        : null;

  /**
   * THE COLUMN — the same three bands `compose.tsx` renders, handed to the REAL
   * `ComposerCanvas` as its `editor` prop, exactly as `compose.tsx:1348` does.
   */
  const column = (
    <View style={styles.column} testID="composer-column">
      <View
        style={[styles.flexRegion, WEB_RECOVERY]}
        testID="composer-flex-region"
      >
        <View
          style={[styles.topRows, isShort ? styles.topRowsShort : null]}
          testID="composer-top-rows"
        >
          <View
            style={[
              styles.whoRow,
              isWideDesktop ? styles.desktopWhoRow : null,
              isShort ? styles.whoRowShort : null,
            ]}
          >
            <ComposerStepWho
              audienceName="Regulars"
              reachableEmail={1102}
              totalAudience={1204}
              onOpenPicker={noop}
              compact={isShort}
            />
          </View>
          <View style={[styles.channelRow, isShort ? styles.channelRowShort : null]}>
            <ChannelTabs active={channel} onChange={setChannel} />
          </View>
        </View>

        {channel === "sms" ? (
          <SmsComposeCard
            value={smsBody}
            onChangeText={setSmsBody}
            reachableSms={1102}
            currencyCode="USD"
            editable
            brandId="harness-brand"
            media={[]}
            maxMedia={10}
            uploading={false}
            onPickMedia={noop}
            onRemoveMedia={noop}
          />
        ) : (
          <ComposerV2Editor
            initialBodyHtml={initialBody}
            subject={subject}
            onSubjectChange={setSubject}
            onBodyChange={setBody}
            editable
            brandEvents={[]}
            templates={[]}
            previewVariables={{} as never}
            brandName="Acme"
            currentDraftIsDirty={false}
            onErrorToast={noop}
          />
        )}
      </View>

      <ComposerCommitScrim />

      <ComposerCommitBar
        onPreview={noop}
        previewLabel={channel === "sms" ? "Preview message" : "Preview email"}
        onPickTime={() => setShowSchedulePicker(true)}
        sendMode={mode}
        scheduledShortLabel={scheduledShortLabel}
        scheduledLongLabel={
          mode === "scheduled" ? "Thursday, October 9 at 10:00 AM" : null
        }
        onCommit={noop}
        commitDisabled={flags.blocked}
        blockedReason={flags.blocked ? "Pick an audience first." : null}
      />
    </View>
  );

  return (
    <ViewportPinnedHost>
      {/* The route TopBar: 56pt + 8pt of padding, on EVERY platform. This is the
          term `CHROME_CONTENT_PX` never counted, and it is what made the
          overflow device-independent at 76pt. */}
      <View style={styles.topBar} testID="harness-top-bar">
        <Text style={styles.topBarText}>Mingla</Text>
      </View>

      <View style={styles.composerHost}>
        {/* BAND A — the real header. */}
        <ComposerHeader
          title="New campaign"
          onBack={noop}
          onSaveDraft={noop}
          saveDraftDisabled
        />

        {/* kavHost — a plain View on web, which is exactly what
            `SmartKeyboardAvoidingView.tsx` renders there
            (`<View style={style}>{children}</View>`). */}
        <View style={styles.kavHost}>
          {/* THE REAL CANVAS. Narrow web takes its narrow branch; >=1024 takes
              the 60/40 editorPane + preview split, including `editorPane`'s
              `overflow:hidden` — the offsetParent RC-3 measured against. */}
          {/* Sub-sheets render INSIDE the keyboard host, per
              feedback_rn_sub_sheet_must_render_inside_parent.md. This is the
              same position `compose.tsx` mounts them in. */}
          <SchedulePickerSheet
            visible={showSchedulePicker}
            initialIso={scheduledForIso}
            onClose={() => setShowSchedulePicker(false)}
            onContinue={onPickerContinue}
          />
          {showReview ? (
            <View style={styles.reviewStub} testID="harness-review-sheet">
              <Text style={styles.topBarText}>Review</Text>
              <Pressable
                onPress={() => setShowReview(false)}
                accessibilityRole="button"
                accessibilityLabel="Back"
                testID="harness-review-back"
                style={styles.reviewBack}
              >
                <Text style={styles.topBarText}>Back</Text>
              </Pressable>
            </View>
          ) : null}
          <ComposerCanvas
            editor={column}
            preview={
              isWideDesktop ? (
                <View style={styles.previewStub} testID="harness-preview-pane">
                  <Text style={styles.topBarText}>Inbox preview</Text>
                </View>
              ) : undefined
            }
          />
        </View>
      </View>
    </ViewportPinnedHost>
  );
}

/**
 * Reads `visualViewport` the way react-native-web's `Dimensions` does, and pins
 * the host to it — mirroring `app/(tabs)/marketing/_layout.tsx` including the
 * flex neutralisation, without which a column ancestor silently discards the
 * pinned height.
 */
function ViewportPinnedHost({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [height, setHeight] = React.useState<number>(() => readVisualHeight());
  React.useEffect(() => {
    const vv = globalThis.visualViewport;
    const onResize = (): void => setHeight(readVisualHeight());
    globalThis.addEventListener("resize", onResize);
    vv?.addEventListener("resize", onResize);
    return () => {
      globalThis.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
    };
  }, []);
  return (
    <SafeAreaProvider initialMetrics={WEB_METRICS}>
      <View
        style={[
          styles.routeHost,
          Platform.OS === "web" && height > 0
            ? { height, flexGrow: 0, flexShrink: 0, flexBasis: "auto" }
            : null,
        ]}
        testID="marketing-tab-layout-host"
      >
        {children}
      </View>
    </SafeAreaProvider>
  );
}

function readVisualHeight(): number {
  const vv = globalThis.visualViewport;
  if (vv !== undefined && vv !== null && typeof vv.height === "number") {
    return Math.round(vv.height * (vv.scale ?? 1));
  }
  return globalThis.innerHeight ?? 0;
}

/**
 * ZERO INSETS, and they are the honest web value. `app/+html.tsx`'s viewport
 * meta carries no `viewport-fit=cover`, so `env(safe-area-inset-*)` resolves to
 * 0 and `insets.bottom` really is 0 on mobile web — which is exactly why the
 * commit bar's `paddingBottom` is `Math.max(insets.bottom, spacing.md)`.
 */
const WEB_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const WEB_RECOVERY =
  Platform.OS === "web" ? ({ overflow: "auto" } as unknown as object) : null;

const styles = StyleSheet.create({
  routeHost: { flex: 1, backgroundColor: canvas.discover },
  topBar: {
    height: 56,
    marginBottom: spacing.sm,
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  topBarText: { color: "rgba(255,255,255,0.96)", fontSize: 16 },
  composerHost: { flex: 1, minHeight: 0 },
  kavHost: { flex: 1, minHeight: 0 },
  column: { flex: 1, minHeight: 0 },
  flexRegion: { flex: 1, minHeight: 0, overflow: "hidden" },
  topRows: { flexShrink: 0 },
  topRowsShort: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  whoRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
  },
  desktopWhoRow: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  whoRowShort: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
  channelRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  channelRowShort: { flexShrink: 0, paddingHorizontal: 0 },
  previewStub: { flex: 1, padding: spacing.md },
  // A stand-in for ComposerReviewSheet. Only its OPEN/DISMISS lifecycle matters
  // to amendment 10.4 — the assertion is that backing out of it leaves the chip
  // holding the chosen time, which is composer state, not review-sheet state.
  reviewStub: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 90,
    backgroundColor: "rgba(12,14,18,0.94)",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  reviewBack: { padding: spacing.md },
});

const container = globalThis.document?.getElementById("root");
if (container !== null && container !== undefined) {
  createRoot(container).render(<Harness />);
}
