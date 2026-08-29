import { Platform, Pressable, StyleSheet, Text } from "react-native";

import {
  BrandRenderingReact as React,
  useBrandRenderingState as useState,
  type BrandRenderingReactElement,
} from "./PublicVenueTabs";

export type PublicVenueRouteState =
  | "cold-loading"
  | "cold-error"
  | "not-found"
  | "populated-refreshing"
  | "populated-error"
  | "populated-ready";

export interface PublicVenueRouteStateInput {
  hasData: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
}

/**
 * Issue #2756 — data presence owns whether the public page may block.
 * React Query deliberately retains usable data during background fetches and
 * background errors, so broad status flags are subordinate to `hasData`.
 */
export const classifyPublicVenueRouteState = ({
  hasData,
  isLoading,
  isFetching,
  isError,
}: PublicVenueRouteStateInput): PublicVenueRouteState => {
  if (hasData) {
    if (isError) return "populated-error";
    return isFetching ? "populated-refreshing" : "populated-ready";
  }
  if (isLoading || isFetching) return "cold-loading";
  if (isError) return "cold-error";
  return "not-found";
};

/** Only bounded classes enter diagnostic metadata; raw provider text never does. */
export const publicVenueRefreshErrorClass = (error: unknown): string => {
  if (error === null || error === undefined) return "unknown";
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : null;
  if (name === "AbortError") return "cancelled";
  if (name.toLowerCase().includes("timeout")) return "timeout";
  if (status !== null && status >= 500 && status <= 599) return "server";
  if (status !== null && status >= 400 && status <= 499) return "client";
  if (error instanceof TypeError) return "transport";
  if (error instanceof Error) return "application";
  return "unknown";
};

export interface PublicVenueRetryActionProps {
  busy: boolean;
  accessibleLabel: string;
  readyLabel?: string;
  busyLabel?: string;
  backgroundColor: string;
  textColor: string;
  focusColor: string;
  focusOffset: number;
  fontFamily?: string | null;
  fontWeight?: "700" | "800";
  onPress: () => void;
  onFocusChange?: (focused: boolean) => void;
}

interface PublicVenueWebRetryHostProps {
  accessibleLabel: string;
  /** Renderer-only compatibility seam; the raw DOM child uses aria-label. */
  accessibilityLabel: string;
  busy: boolean;
  label: BrandRenderingReactElement;
  style: object;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onPointerDown: (event: { preventDefault: () => void }) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClick: (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
  onKeyDown: (event: {
    key: string;
    repeat: boolean;
    preventDefault: () => void;
  }) => void;
  onKeyUp: (event: { key: string; preventDefault: () => void }) => void;
}

/** Raw web host: RNW promotes aria-disabled buttons to HTML disabled. */
const PublicVenueWebRetryHost = ({
  accessibleLabel,
  busy,
  label,
  style,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onClick,
  onKeyDown,
  onKeyUp,
}: PublicVenueWebRetryHostProps): BrandRenderingReactElement =>
  React.createElement(
    "button",
    {
      type: "button",
      role: "button",
      "aria-label": accessibleLabel,
      "aria-disabled": busy,
      "aria-busy": busy,
      tabIndex: 0,
      onFocus,
      onBlur,
      onMouseEnter,
      onMouseLeave,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onClick,
      onKeyDown,
      onKeyUp,
      style,
    },
    label,
  );

/** Shared 44-point retry action for the populated and cold route states. */
export const PublicVenueRetryAction = ({
  busy,
  accessibleLabel,
  readyLabel = "Try again",
  busyLabel = "Trying…",
  backgroundColor,
  textColor,
  focusColor,
  focusOffset,
  fontFamily,
  fontWeight = "800",
  onPress,
  onFocusChange,
}: PublicVenueRetryActionProps): BrandRenderingReactElement => {
  const [keyboardFocused, setKeyboardFocused] = useState<boolean>(false);
  const [hovered, setHovered] = useState<boolean>(false);
  const [pressed, setPressed] = useState<boolean>(false);
  const keyboardModalityRef = React.useRef<boolean>(false);
  const spaceKeyArmedRef = React.useRef<boolean>(false);

  React.useEffect((): (() => void) => {
    if (Platform.OS !== "web") return () => undefined;
    const documentValue = (
      globalThis as {
        document?: {
          addEventListener: (name: string, listener: () => void) => void;
          removeEventListener: (name: string, listener: () => void) => void;
        };
      }
    ).document;
    if (documentValue === undefined) return () => undefined;
    const markKeyboard = (): void => {
      keyboardModalityRef.current = true;
    };
    const markPointer = (): void => {
      keyboardModalityRef.current = false;
    };
    documentValue.addEventListener("keydown", markKeyboard);
    documentValue.addEventListener("pointerdown", markPointer);
    return () => {
      documentValue.removeEventListener("keydown", markKeyboard);
      documentValue.removeEventListener("pointerdown", markPointer);
    };
  }, []);

  const handleFocus = (): void => {
    onFocusChange?.(true);
    if (Platform.OS === "web" && keyboardModalityRef.current) {
      setKeyboardFocused(true);
    }
  };
  const handleBlur = (): void => {
    onFocusChange?.(false);
    setKeyboardFocused(false);
    setPressed(false);
    spaceKeyArmedRef.current = false;
  };
  const actionStyle = [
    styles.action,
    { backgroundColor },
    pressed && !busy && styles.pressed,
    busy && styles.busy,
    Platform.OS === "web"
      ? ({ cursor: busy ? "default" : "pointer" } as object)
      : null,
    Platform.OS === "web" && keyboardFocused
      ? ({
          outlineWidth: 3,
          outlineStyle: "solid",
          outlineColor: focusColor,
          outlineOffset: focusOffset,
        } as object)
      : null,
  ];
  const label = React.createElement(
    Text,
    {
      style: [
        styles.label,
        fontFamily === null || fontFamily === undefined
          ? null
          : { fontFamily },
        { fontWeight },
        { color: textColor },
        Platform.OS === "web" && hovered
          ? styles.hoveredLabel
          : null,
      ],
    },
    busy ? busyLabel : readyLabel,
  );

  if (Platform.OS === "web") {
    // #2756 — RNW Pressable derives `tabIndex=-1` from `disabled` and writes
    // its own aria-disabled after caller props. A focused retry must remain the
    // same focusable host while busy so successful disappearance can restore
    // the selected tab. This web host owns truthful ARIA and suppresses every
    // activation path synchronously without using the HTML/RNW disabled bit.
    const webProps: PublicVenueWebRetryHostProps = {
      accessibilityLabel: accessibleLabel,
      accessibleLabel,
      busy,
      label,
      // Retained on the wrapper for the mounted renderer regression seam; the
      // raw browser child activates exclusively through the handlers below.
      onPress: () => {
        if (!busy) onPress();
      },
      onFocus: handleFocus,
      onBlur: handleBlur,
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => {
        setHovered(false);
        setPressed(false);
      },
      onPointerDown: (event: { preventDefault: () => void }) => {
        keyboardModalityRef.current = false;
        setKeyboardFocused(false);
        if (busy) {
          event.preventDefault();
          return;
        }
        setPressed(true);
      },
      onPointerUp: () => setPressed(false),
      onPointerCancel: () => setPressed(false),
      onClick: (event: {
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => {
        if (busy) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onPress();
      },
      onKeyDown: (event: {
        key: string;
        repeat: boolean;
        preventDefault: () => void;
      }) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (busy || event.repeat) return;
        if (event.key === "Enter") {
          onPress();
          return;
        }
        spaceKeyArmedRef.current = true;
        setPressed(true);
      },
      onKeyUp: (event: { key: string; preventDefault: () => void }) => {
        if (event.key !== " ") return;
        event.preventDefault();
        setPressed(false);
        if (!busy && spaceKeyArmedRef.current) onPress();
        spaceKeyArmedRef.current = false;
      },
      style: {
        ...StyleSheet.flatten(actionStyle),
        appearance: "none",
        border: "none",
        boxSizing: "border-box",
        display: "flex",
        font: "inherit",
      },
    };
    return React.createElement(PublicVenueWebRetryHost, webProps);
  }

  return React.createElement(
    Pressable,
    {
      onPress,
      disabled: busy,
      accessibilityRole: "button",
      accessibilityLabel: accessibleLabel,
      accessibilityState: { disabled: busy, busy },
      onFocus: handleFocus,
      onBlur: handleBlur,
      style: ({ pressed }: { pressed: boolean }) => [
        styles.action,
        { backgroundColor },
        pressed && !busy && styles.pressed,
        busy && styles.busy,
      ],
    },
    label,
  );
};

const styles = StyleSheet.create({
  action: {
    minWidth: 112,
    minHeight: 44,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  hoveredLabel: {
    textDecorationLine: "underline",
  },
  pressed: {
    opacity: 0.86,
  },
  busy: {
    opacity: 0.64,
  },
});
