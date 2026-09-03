import React from "react";
import {
  AppState,
  AccessibilityInfo,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  BrandBookExportError,
  createBrandBookExportRequestId,
  getBrandBookExport,
  requestBrandBookExport,
  type BrandBookExportJob,
} from "../../services/brandBookExportService";
import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { Spinner } from "../ui/Spinner";

type ExportView = "idle" | "preparing" | "ready" | "failed" | "expired" | "long" | "permission";

interface WebFocusTarget {
  focus?: () => void;
}

interface WebDialog extends WebFocusTarget {
  contains?: (target: unknown) => boolean;
  querySelectorAll?: (selector: string) => ArrayLike<WebFocusTarget>;
}

interface WebKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

interface WebDocument {
  activeElement?: WebFocusTarget | null;
  addEventListener: (type: "keydown", listener: (event: WebKeyEvent) => void) => void;
  removeEventListener: (type: "keydown", listener: (event: WebKeyEvent) => void) => void;
}

export interface BrandBookExportSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string;
  contactCount: number | null;
  online: boolean;
  authorized: boolean;
  permissionCaption: string;
  onDownloaded: () => void;
  onAuthRequired: () => void;
  onPermissionDenied: () => void;
}

const POLL_FAST_MS = 2_000;
const POLL_SLOW_MS = 5_000;
const FAST_WINDOW_MS = 30_000;
const LONG_RUNNING_MS = 120_000;

function useReducedMotionPreference(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    const accessibility = AccessibilityInfo as typeof AccessibilityInfo | undefined;
    void accessibility?.isReduceMotionEnabled?.().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => undefined);
    const subscription = accessibility?.addEventListener?.("reduceMotionChanged", (enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    return (): void => {
      mounted = false;
      subscription?.remove();
    };
  }, []);
  return reduceMotion;
}

export function BrandBookExportSheet({
  visible,
  onClose,
  brandId,
  contactCount,
  online,
  authorized,
  permissionCaption,
  onDownloaded,
  onAuthRequired,
  onPermissionDenied,
}: BrandBookExportSheetProps): React.ReactElement {
  const [view, setView] = React.useState<ExportView>(authorized ? "idle" : "permission");
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [exportCount, setExportCount] = React.useState<number | null>(contactCount);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [foreground, setForeground] = React.useState(AppState.currentState === "active");
  const [pollCycle, setPollCycle] = React.useState(0);
  const reduceMotion = useReducedMotionPreference();
  const inFlightRef = React.useRef(false);
  const scopeVersionRef = React.useRef(0);
  const availableRef = React.useRef(online && AppState.currentState === "active");
  const dialogRef = React.useRef<React.ElementRef<typeof View> | null>(null);
  const closeRef = React.useRef<React.ElementRef<typeof Pressable> | null>(null);

  const applyJob = React.useCallback((job: BrandBookExportJob): void => {
    // The create RPC reports the job's initial row_count (zero while queued),
    // while status owns the terminal result. Never replace the visible book
    // count with that pre-worker placeholder.
    if (job.status === "ready" && job.exportableCount !== null) {
      setExportCount(job.exportableCount);
    }
    if (job.status === "ready") setView("ready");
    else if (job.status === "failed") setView("failed");
    else if (job.status === "expired") setView("expired");
    else setView("preparing");
  }, []);

  const handleError = React.useCallback((error: unknown): void => {
    if (error instanceof BrandBookExportError && error.code === "unauthorized") {
      setJobId(null);
      setView("idle");
      onAuthRequired();
      return;
    }
    if (error instanceof BrandBookExportError && error.code === "forbidden") {
      setJobId(null);
      setView("permission");
      onPermissionDenied();
      return;
    }
    setView("failed");
  }, [onAuthRequired, onPermissionDenied]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
    });
    return (): void => subscription.remove();
  }, []);

  React.useEffect(() => (): void => {
    // Invalidate every outstanding request before React tears the component
    // down so a late edge response cannot update an unmounted sheet.
    scopeVersionRef.current += 1;
    inFlightRef.current = false;
  }, []);

  React.useEffect(() => {
    scopeVersionRef.current += 1;
    setView("idle");
    setJobId(null);
    setExportCount(null);
    setStartedAt(null);
    inFlightRef.current = false;
  }, [brandId]);

  React.useEffect(() => {
    if (jobId === null && view === "idle") setExportCount(contactCount);
  }, [contactCount, jobId, view]);

  React.useEffect(() => {
    scopeVersionRef.current += 1;
    if (!authorized) {
      setView("permission");
      setJobId(null);
      inFlightRef.current = false;
    } else {
      setView((current) => current === "permission" ? "idle" : current);
    }
  }, [authorized]);

  const checkStatus = React.useCallback(async (): Promise<BrandBookExportJob["status"] | null> => {
    if (jobId === null || !authorized || !online || !foreground || inFlightRef.current) return null;
    const scopeVersion = scopeVersionRef.current;
    inFlightRef.current = true;
    try {
      const job = await getBrandBookExport(jobId);
      if (scopeVersion !== scopeVersionRef.current || !authorized) return null;
      applyJob(job);
      return job.status;
    } catch (error) {
      if (scopeVersion !== scopeVersionRef.current) return null;
      handleError(error);
      return null;
    } finally {
      if (scopeVersion === scopeVersionRef.current) {
        inFlightRef.current = false;
        setPollCycle((cycle) => cycle + 1);
      }
    }
  }, [applyJob, authorized, foreground, handleError, jobId, online]);

  React.useEffect(() => {
    if (jobId === null || view !== "preparing" || !online || !foreground || startedAt === null) {
      return undefined;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= LONG_RUNNING_MS) {
      // One final foreground/online lookup prevents a job that completed while
      // the app was paused from being mislabeled as long-running.
      void checkStatus().then((status) => {
        if (status === "queued" || status === "running") setView("long");
      });
      return undefined;
    }
    const delay = elapsed < FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
    const timer = setTimeout(() => {
      void checkStatus();
    }, delay);
    return (): void => clearTimeout(timer);
  }, [checkStatus, foreground, jobId, online, pollCycle, startedAt, view]);

  React.useEffect(() => {
    const available = online && foreground;
    const resumed = available && !availableRef.current;
    availableRef.current = available;
    if (resumed && jobId !== null) void checkStatus();
  }, [checkStatus, foreground, jobId, online]);

  React.useEffect(() => {
    if (!visible || Platform.OS !== "web") return undefined;
    const documentValue = (globalThis as { document?: WebDocument }).document;
    if (documentValue === undefined) return undefined;
    const selector = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const focusables = (): WebFocusTarget[] => Array.from(
      (dialogRef.current as unknown as WebDialog | null)?.querySelectorAll?.(selector) ?? [],
    );
    const focusTimer = setTimeout(() => {
      const first = focusables()[0];
      if (first !== undefined) first.focus?.();
      else closeRef.current?.focus?.();
    }, 0);
    const onKeyDown = (event: WebKeyEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const items = focusables();
        if (items.length === 0) {
          event.preventDefault();
          return;
        }
        const active = documentValue.activeElement;
        const first = items[0];
        const last = items[items.length - 1];
        const dialog = dialogRef.current as unknown as WebDialog | null;
        if (event.shiftKey && (active === first || dialog?.contains?.(active) !== true)) {
          event.preventDefault();
          last?.focus?.();
        } else if (!event.shiftKey && (active === last || dialog?.contains?.(active) !== true)) {
          event.preventDefault();
          first?.focus?.();
        }
      }
    };
    documentValue.addEventListener("keydown", onKeyDown);
    return (): void => {
      clearTimeout(focusTimer);
      documentValue.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, visible]);

  const prepare = React.useCallback(async (): Promise<void> => {
    if (!authorized || !online || inFlightRef.current) return;
    const scopeVersion = scopeVersionRef.current;
    inFlightRef.current = true;
    const requestedAt = Date.now();
    setStartedAt(requestedAt);
    setView("preparing");
    setExportCount(contactCount);
    try {
      const job = await requestBrandBookExport({
        brandId,
        clientRequestId: createBrandBookExportRequestId(),
      });
      if (scopeVersion !== scopeVersionRef.current || !authorized) return;
      setJobId(job.jobId);
      applyJob(job);
    } catch (error) {
      if (scopeVersion !== scopeVersionRef.current) return;
      handleError(error);
    } finally {
      if (scopeVersion === scopeVersionRef.current) inFlightRef.current = false;
    }
  }, [applyJob, authorized, brandId, contactCount, handleError, online]);

  const checkAgain = React.useCallback(async (): Promise<void> => {
    if (!online || inFlightRef.current) return;
    setView("preparing");
    const status = await checkStatus();
    if (
      (status === "queued" || status === "running") &&
      startedAt !== null &&
      Date.now() - startedAt >= LONG_RUNNING_MS
    ) {
      setView("long");
    }
  }, [checkStatus, online, startedAt]);

  const download = React.useCallback(async (): Promise<void> => {
    if (jobId === null || !authorized || !online || inFlightRef.current) return;
    const scopeVersion = scopeVersionRef.current;
    inFlightRef.current = true;
    try {
      // A signed URL lives for only 60 seconds. Fetch a fresh status on every
      // tap; never persist or reuse the URL in component state.
      const current = await getBrandBookExport(jobId);
      if (scopeVersion !== scopeVersionRef.current || !authorized) return;
      applyJob(current);
      if (current.status === "ready" && current.signedUrl !== null) {
        await Linking.openURL(current.signedUrl);
        onClose();
        onDownloaded();
      }
    } catch (error) {
      if (scopeVersion !== scopeVersionRef.current) return;
      handleError(error);
    } finally {
      if (scopeVersion === scopeVersionRef.current) inFlightRef.current = false;
    }
  }, [applyJob, authorized, handleError, jobId, onClose, onDownloaded, online]);

  const offline = !online && view !== "permission";
  const title = view === "ready"
    ? "Your CSV is ready"
    : view === "preparing"
      ? "Preparing your CSV…"
    : view === "long"
      ? "Still preparing"
      : "Export your book";

  const action = (() => {
    if (view === "permission") return null;
    if (offline) {
      const offlineLabel = view === "ready"
        ? "Download CSV"
        : view === "expired"
          ? "Prepare new CSV"
          : view === "failed"
            ? "Try again"
            : view === "long"
              ? "Check again"
              : "Prepare CSV";
      return <Button label={offlineLabel} fullWidth disabled onPress={() => undefined} />;
    }
    if (view === "preparing") {
      return <Button label="Preparing your CSV…" fullWidth loading disabled onPress={() => undefined} />;
    }
    if (view === "ready") {
      return <Button label="Download CSV" leadingIcon="download" fullWidth onPress={download} />;
    }
    if (view === "failed") {
      return <Button label="Try again" fullWidth onPress={prepare} />;
    }
    if (view === "expired") {
      return <Button label="Prepare new CSV" fullWidth onPress={prepare} />;
    }
    if (view === "long") {
      return <Button label="Check again" variant="secondary" fullWidth onPress={checkAgain} />;
    }
    return <Button label="Prepare CSV" fullWidth onPress={prepare} />;
  })();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.8}
      testID="brand-book-export-sheet"
      style={styles.sheet}
      panelBackground={Platform.OS === "android" ? "#16181b" : undefined}
    >
      <View
        ref={dialogRef}
        accessibilityLabel={title}
        accessibilityViewIsModal
        aria-modal={Platform.OS === "web" ? true : undefined}
        role={Platform.OS === "web" ? "dialog" : undefined}
        style={styles.host}
      >
        <View style={styles.header}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={styles.title}>{title}</Text>
            {view === "ready" ? (
              <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} style={styles.subtitle}>
                {exportCount} contacts — available for 24 hours
              </Text>
            ) : null}
          </View>
          <Pressable
            ref={closeRef}
            accessibilityLabel="Close export"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed ? styles.pressed : undefined]}
          >
            <Icon name="close" size={20} color={text.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {view === "permission" ? (
            <StateMessage icon="shield" tone="warning" body={permissionCaption} />
          ) : view === "idle" ? (
            <>
              <View style={styles.boundary}>
                <Icon name="shield" size={22} color={accent.warm} />
                <Text maxFontSizeMultiplier={2} style={styles.boundaryText}>
                  This CSV includes only contact details people gave this brand. Mingla profile data and circle-only contacts stay private.
                </Text>
              </View>
              {offline ? (
                <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} style={styles.offlineCopy}>
                  {"You're offline. Reconnect to prepare or download the export."}
                </Text>
              ) : null}
              {contactCount !== null ? (
                <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={2} style={styles.count}>{contactCount} contacts</Text>
              ) : null}
              <ExportList
                title="Included"
                items={[
                  "Names",
                  "Email addresses and phone numbers provided to this brand",
                  "Communication opt-out status",
                ]}
              />
              <ExportList
                title="Kept private"
                items={["Mingla-only profile details and circle connections"]}
              />
              <Text maxFontSizeMultiplier={2} style={styles.note}>This export is logged and stays available for 24 hours.</Text>
            </>
          ) : offline ? (
            <StateMessage body="You're offline. Reconnect to prepare or download the export." />
          ) : view === "preparing" ? (
            <View accessibilityLiveRegion="polite" style={styles.progress}>
              {reduceMotion ? (
                <Icon name="clock" size={28} color={accent.warm} />
              ) : (
                <Spinner size={36} />
              )}
              <Text maxFontSizeMultiplier={2} style={styles.body}>You can close this sheet. We’ll keep preparing it.</Text>
            </View>
          ) : view === "failed" ? (
            <StateMessage tone="error" body="We couldn't prepare the export. Try again." />
          ) : view === "expired" ? (
            <StateMessage body="This export expired. Prepare a new CSV to download it." />
          ) : view === "long" ? (
            <StateMessage body="This is taking longer than usual. Check again in a moment." />
          ) : view === "ready" ? (
            <View accessibilityLiveRegion="polite" style={styles.readyIcon}>
              <Icon name="check" size={28} color={semantic.success} />
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>{action}</View>
      </View>
    </Sheet>
  );
}

function ExportList({ title, items }: { title: string; items: string[] }): React.ReactElement {
  return (
    <View style={styles.listBlock}>
      <Text maxFontSizeMultiplier={2} style={styles.listTitle}>{title}</Text>
      {items.map((item) => (
        <View key={item} style={styles.listRow}>
          <View style={styles.bullet} />
          <Text maxFontSizeMultiplier={2} style={styles.body}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function StateMessage({
  body,
  icon,
  tone,
}: {
  body: string;
  icon?: "shield";
  tone?: "error" | "warning";
}): React.ReactElement {
  const color = tone === "error" ? semantic.error : tone === "warning" ? semantic.warning : text.secondary;
  const toneStyle = tone === "error"
    ? styles.stateMessageError
    : tone === "warning"
      ? styles.stateMessageWarning
      : styles.stateMessageNeutral;
  return (
    <View
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={styles.stateMessage}
    >
      {icon ? <Icon name={icon} size={28} color={color} /> : null}
      <Text maxFontSizeMultiplier={2} style={[styles.body, toneStyle]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { width: "100%", maxWidth: 640, alignSelf: "center" },
  host: { flex: 1, minHeight: 0 },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { ...typography.h3, color: text.primary },
  subtitle: { ...typography.bodySm, color: text.secondary, marginTop: spacing.xs },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  pressed: { opacity: 0.72 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  boundary: {
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
  },
  boundaryText: { ...typography.body, color: text.primary, flex: 1 },
  offlineCopy: { ...typography.bodySm, color: semantic.warning },
  count: { ...typography.h3, color: text.primary },
  listBlock: { gap: spacing.sm },
  listTitle: { ...typography.body, fontWeight: "700", color: text.primary },
  listRow: { minHeight: 24, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: accent.warm, marginTop: 7 },
  body: { ...typography.bodySm, color: text.secondary, flexShrink: 1 },
  note: { ...typography.bodySm, color: text.tertiary },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  progress: { flex: 1, minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  stateMessage: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  stateMessageNeutral: { color: text.secondary },
  stateMessageWarning: { color: semantic.warning },
  stateMessageError: { color: semantic.error },
  readyIcon: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: semantic.successTint,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.xl,
  },
});
