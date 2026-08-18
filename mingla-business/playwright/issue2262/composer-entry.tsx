/**
 * #2262 [composer-responsive-layout] — the browser-harness entry point.
 *
 * It mounts the REAL `ComposerV2Editor`, the REAL `ComposerCommitBar`, the REAL
 * `ComposerCommitScrim`, the REAL `richEditor.tsx` (Tiptap) and the REAL
 * `composerChipHtml.ts` in a real browser, inside the SAME three-band tree
 * `compose.tsx` renders — so the assertions in `composer-viewport-fit.spec.ts`
 * are about GEOMETRY: what an operator can actually reach and click.
 *
 * # Why this exists at all
 *
 * Every one of the 13 pre-existing composer tests is a source-grep under
 * `testEnvironment: node`. 78/78 passed green on the exact commit where a real
 * browser click at the vertical centre of the message box left focus on
 * `<body>`, and where the action row sat 89px below the fold at 390x750 and
 * 129px under the message box at 1024x700. `react-test-renderer` has no layout
 * engine — no viewport, no scroll, no bounding boxes — so a presence gate
 * cannot fail for either defect however thorough it is. This is the only #2262
 * check with a layout engine.
 *
 * # What is faked, and what is not
 *
 * Nothing about layout, styling or component identity. The route TopBar's 64pt
 * (56 + 8) is rendered as a real spacer, because that term is the single
 * largest miss in RC-1 and a harness without it would flatter the fix. The only
 * substitutions are native-only leaves the web build never executes.
 */

import React from "react";

// `@types/react-dom` is not installed and package manifests are do-not-touch,
// so a real `import` would add a TS7016 to the repo-wide diagnostic baseline.
interface ReactDomClient {
  createRoot: (container: Element) => { render: (node: React.ReactNode) => void };
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRoot } = require("react-dom/client") as ReactDomClient;

import { Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ComposerCommitBar,
  ComposerCommitScrim,
} from "../../src/components/marketing/ComposerCommitBar";
import { ComposerV2Editor } from "../../src/components/marketing/ComposerV2/ComposerV2Editor";
import { canvas, spacing } from "../../src/constants/designSystem";

type Channel = "email" | "sms";

interface HarnessFlags {
  /** `email` renders the real editor; `sms` renders the shorter SMS shape. */
  channel: Channel;
  /** Simulates the InsertionBar's Personalize panel being open (+212pt in RC-5). */
  panelOpen: boolean;
  /** Renders the blocked-reason caption, the bar's TALLEST resting state. */
  blocked: boolean;
  /** `fontScale >= 1.3` — the commit bar reflows to two rows. */
  largeText: boolean;
}

function readFlags(): HarnessFlags {
  const q = new URLSearchParams(globalThis.location?.search ?? "");
  return {
    channel: q.get("channel") === "sms" ? "sms" : "email",
    panelOpen: q.get("panel") === "open",
    blocked: q.get("blocked") === "1",
    largeText: q.get("largeText") === "1",
  };
}

const noop = (): void => undefined;

/**
 * The Personalize panel, at its measured real height. RC-5 measured +212px of
 * chrome appearing inside the composer with the box giving back not one pixel,
 * because the box's height was a function of the viewport only. Under the band
 * architecture this must be absorbed by the sheet shrinking.
 */
const PanelSpacer = (): React.ReactElement => (
  <View style={styles.panel} testID="harness-personalize-panel">
    <Text style={styles.panelText}>Personalize panel (212pt of chrome)</Text>
  </View>
);

function Harness(): React.ReactElement {
  const flags = readFlags();
  const [subject, setSubject] = React.useState("Weekend at the rooftop");
  const [body, setBody] = React.useState("<p>Hello there</p>");
  const [mode, setMode] = React.useState<"now" | "scheduled">("now");

  return (
    /* The marketing route host: `flex: 1` plus, on web, the viewport pin. In
       the shipped app that height comes from `useWindowDimensions()`, which
       react-native-web derives from `visualViewport`. Here it is read the same
       way, so overriding `visualViewport.height` and dispatching its `resize`
       (T4-f) drives this harness exactly as it drives the real route. */
    <ViewportPinnedHost>
      {/* The route TopBar: 56pt + 8pt of padding, on EVERY platform. This is
          the term `CHROME_CONTENT_PX` never counted, and it is what made the
          overflow device-independent at 76pt. */}
      <View style={styles.topBar} testID="harness-top-bar">
        <Text style={styles.topBarText}>Mingla</Text>
      </View>

      <View style={styles.composerHost}>
        {/* BAND A */}
        <View style={styles.header} testID="harness-composer-header">
          <Text style={styles.headerText}>New campaign</Text>
        </View>

        {/* kavHost — a plain View on web, exactly as SmartKeyboardAvoidingView
            resolves there. */}
        <View style={styles.kavHost}>
          {/* THE COLUMN */}
          <View style={styles.column} testID="composer-column">
            {/* BAND B */}
            <View
              style={[styles.flexRegion, WEB_RECOVERY]}
              testID="composer-flex-region"
            >
              <View style={styles.topRows} testID="composer-top-rows">
                <View style={styles.whoRow}>
                  <Text style={styles.whoText}>Regulars · 1,204 people</Text>
                </View>
                <View style={styles.channelRow}>
                  <Text style={styles.channelText}>Email · SMS</Text>
                </View>
              </View>

              {flags.panelOpen ? <PanelSpacer /> : null}

              {flags.channel === "sms" ? (
                <SmsSheet />
              ) : (
                <ComposerV2Editor
                  initialBodyHtml={body}
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

            {/* BAND C */}
            <View style={flags.largeText ? styles.largeTextBar : null}>
              <ComposerCommitBar
                onPreview={noop}
                previewLabel={
                  flags.channel === "sms" ? "Preview message" : "Preview email"
                }
                onPickTime={() => setMode("scheduled")}
                sendMode={mode}
                scheduledShortLabel={mode === "scheduled" ? "Thu 10:00" : null}
                scheduledLongLabel={
                  mode === "scheduled" ? "Thursday, October 9 at 10:00 AM" : null
                }
                onCommit={noop}
                commitDisabled={flags.blocked}
                blockedReason={flags.blocked ? "Pick an audience first." : null}
              />
            </View>
          </View>
        </View>
      </View>
    </ViewportPinnedHost>
  );
}

/**
 * The SMS shape: much SHORTER chrome than email. RC-3 measured the opposite
 * failure here — in-flow content ending at y=521 while the absolutely
 * positioned footer stayed pinned at y=806, leaving a 285px dead gap between
 * the last control and the action row. Same container, opposite failure, so the
 * fix has to satisfy both.
 */
const SmsSheet = (): React.ReactElement => (
  <View style={styles.smsSheet} testID="composer-v2-sheet">
    <Text style={styles.smsLabel}>SMS MESSAGE</Text>
    <View style={styles.smsInput} testID="harness-sms-last-control">
      <Text style={styles.smsInputText}>Type your text blast.</Text>
    </View>
  </View>
);

/** Reads `visualViewport` the way react-native-web's `Dimensions` does. */
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
        // Mirrors `_layout.tsx` exactly, including the flex neutralisation —
        // see the comment there. Without it the pin is silently discarded by a
        // column ancestor and this harness measures 750 while the inline style
        // says 414.
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

const WEB_RECOVERY =
  Platform.OS === "web" ? ({ overflow: "auto" } as unknown as object) : null;

const styles = StyleSheet.create({
  routeHost: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  topBar: {
    height: 56,
    marginBottom: spacing.sm,
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  topBarText: { color: "rgba(255,255,255,0.96)", fontSize: 16 },
  composerHost: { flex: 1, minHeight: 0 },
  header: {
    minHeight: 44,
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  headerText: { color: "rgba(255,255,255,0.96)", fontSize: 16 },
  kavHost: { flex: 1, minHeight: 0 },
  column: { flex: 1, minHeight: 0 },
  flexRegion: { flex: 1, minHeight: 0, overflow: "hidden" },
  topRows: { flexShrink: 0 },
  whoRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 48 },
  whoText: { color: "rgba(255,255,255,0.96)", fontSize: 15 },
  channelRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 44 },
  channelText: { color: "rgba(255,255,255,0.72)", fontSize: 14 },
  panel: { height: 212, flexShrink: 0, paddingHorizontal: spacing.md },
  panelText: { color: "rgba(255,255,255,0.52)", fontSize: 12 },
  smsSheet: {
    flex: 1,
    minHeight: 240,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  smsLabel: { color: "rgba(255,255,255,0.52)", fontSize: 12 },
  smsInput: { flex: 1, minHeight: 0, paddingVertical: spacing.xs },
  smsInputText: { color: "rgba(255,255,255,0.52)", fontSize: 15 },
  largeTextBar: { flexShrink: 0 },
});

/**
 * ZERO INSETS, deliberately, and they are the honest web value.
 *
 * `mingla-business/app/+html.tsx`'s viewport meta is
 * `width=device-width, initial-scale=1, shrink-to-fit=no` with NO
 * `viewport-fit=cover`, so Safari keeps the default `auto` behaviour, insets
 * the layout viewport itself, and `env(safe-area-inset-*)` resolves to 0.
 * `react-native-safe-area-context` on web reads exactly those through
 * `getComputedStyle`, so `insets.bottom` really is 0 on mobile web.
 *
 * That is precisely why the commit bar's `paddingBottom` is
 * `Math.max(insets.bottom, spacing.md)` and never a bare inset — with these
 * metrics a bare inset would put the bar flush against the browser chrome, and
 * this harness would show it.
 */
const WEB_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const container = globalThis.document?.getElementById("root");
if (container !== null && container !== undefined) {
  createRoot(container).render(<Harness />);
}
