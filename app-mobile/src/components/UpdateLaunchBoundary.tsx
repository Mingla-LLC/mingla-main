// #2107 (U1) — the root error boundary that turns a broken OTA's blank screen
// into either a rollback or a restart screen.
//
// Mirrored in app-mobile and mingla-business; the two copies may differ
// only in the relative path to services/ (parity-gated by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs).
//
// - Inside the launch window of an eligible update, a caught render error is
//   escalated to a fatal from getDerivedStateFromError: that is the render
//   phase, BEFORE the fallback commits, so the fatal reaches expo-updates
//   before any new native content can appear. The boundary then renders
//   nothing while native recovery relaunches the previous update, and shows
//   the restart screen if nothing has happened after the hold.
// - Every other caught error shows the restart screen, never a blank one.
// - The first healthy commit confirms the launch good (updateLaunchGuard.ts
//   explains why that, and not a later screen, is the line).
// - In __DEV__ the error is rethrown, so development keeps the red box.

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { UPDATE_LAUNCH_ESCALATION_HOLD_MS } from "../services/updateLaunchGuard";
import {
  getUpdateLaunchGuard,
  hideSplashForLaunchError,
  installUpdateLaunchGuard,
  requestLaunchErrorRestart,
} from "../services/updateLaunchRuntime";

// Installed when the root layout imports this file, before Sentry.init wraps
// the global handler. Never throws.
installUpdateLaunchGuard();

type BoundaryView = "children" | "hold" | "restart";

type BoundaryState = { error: unknown; view: BoundaryView };

export function LaunchErrorRestartScreen(): React.ReactElement {
  const [restarting, setRestarting] = React.useState(false);

  React.useEffect(() => {
    // A launch that failed in its first render never hid the native splash.
    hideSplashForLaunchError();
  }, []);

  const onRestart = React.useCallback(() => {
    if (restarting) return;
    setRestarting(true);
    requestLaunchErrorRestart()
      .catch((error: unknown) => {
        console.warn("[update-launch-guard] restart failed", error);
      })
      .finally(() => setRestarting(false));
  }, [restarting]);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title} accessibilityRole="header">
          Something went wrong
        </Text>
        <Text style={styles.message}>Restarting the app usually fixes this.</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable
          onPress={onRestart}
          disabled={restarting}
          accessibilityRole="button"
          accessibilityLabel="Tap to restart the app"
          accessibilityState={{ disabled: restarting, busy: restarting }}
          style={({ pressed }) => [styles.button, (pressed || restarting) && styles.buttonPressed]}
        >
          <Text style={styles.buttonText} numberOfLines={1} maxFontSizeMultiplier={1.6}>
            {restarting ? "Restarting…" : "Tap to restart"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export class UpdateLaunchBoundary extends React.Component<
  { children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null, view: "children" };

  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: unknown): BoundaryState {
    let view: BoundaryView = "restart";
    try {
      const outcome = getUpdateLaunchGuard()?.handleError(error, "root_boundary");
      if (outcome?.kind === "escalated") view = "hold";
    } catch (guardError) {
      console.warn("[update-launch-guard] boundary check failed", guardError);
    }
    return { error, view };
  }

  componentDidMount(): void {
    if (this.state.view === "children") getUpdateLaunchGuard()?.noteHealthyCommit();
    this.scheduleHoldEnd();
  }

  componentDidUpdate(): void {
    this.scheduleHoldEnd();
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(
      "[update-launch-guard] root render error",
      error,
      info.componentStack?.slice(0, 500),
    );
  }

  componentWillUnmount(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private scheduleHoldEnd(): void {
    if (this.state.view !== "hold" || this.holdTimer !== null) return;
    // Native recovery should have relaunched by now; never leave a blank screen.
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      this.setState({ view: "restart" });
    }, UPDATE_LAUNCH_ESCALATION_HOLD_MS);
  }

  render(): React.ReactNode {
    if (this.state.view === "children") return this.props.children;
    if (__DEV__) throw this.state.error;
    if (this.state.view === "hold") return null;
    return <LaunchErrorRestartScreen />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    color: "#4b5563",
    textAlign: "center",
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  button: {
    backgroundColor: "#eb7825",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
