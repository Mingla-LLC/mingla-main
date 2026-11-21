/**
 * issue #4508 round 9 — whether the keyboard is up, from the keyboard events
 * in the order iOS really sends them.
 *
 * react-native-keyboard-controller's own `isVisible` turns on at
 * keyboardWillShow and off at keyboardDidHide, and ignores keyboardDidShow.
 * When a new input takes focus while the previous keyboard is still going
 * away, iOS sends: willHide (old) → willShow (new) → didHide (old) → didShow
 * (new). Proven on the iPhone SE simulator after a country pick: the late
 * didHide left the library reading "closed" with the phone pad up, so the
 * app-wide Done bar vanished until the next keyboard event (the first key).
 *
 * Here a didHide only closes the keyboard when no show began after the hide
 * started, and a didShow always opens it. Pure, so it is unit-tested.
 */
export type KeyboardVisibilityEvent =
  | "keyboardWillShow"
  | "keyboardDidShow"
  | "keyboardWillHide"
  | "keyboardDidHide";

export interface KeyboardVisibility {
  /** The keyboard is on screen (or coming up). */
  visible: boolean;
  /** The most recent will-event was a show (a later didHide is stale). */
  showing: boolean;
}

export const KEYBOARD_VISIBILITY_EVENTS: ReadonlyArray<KeyboardVisibilityEvent> = [
  "keyboardWillShow",
  "keyboardDidShow",
  "keyboardWillHide",
  "keyboardDidHide",
];

export function nextKeyboardVisibility(
  state: KeyboardVisibility,
  event: KeyboardVisibilityEvent,
): KeyboardVisibility {
  switch (event) {
    case "keyboardWillShow":
    case "keyboardDidShow":
      return state.visible && state.showing ? state : { visible: true, showing: true };
    case "keyboardWillHide":
      return state.showing ? { visible: state.visible, showing: false } : state;
    case "keyboardDidHide":
      return state.showing || !state.visible ? state : { visible: false, showing: false };
    default: {
      const never: never = event;
      return never;
    }
  }
}
