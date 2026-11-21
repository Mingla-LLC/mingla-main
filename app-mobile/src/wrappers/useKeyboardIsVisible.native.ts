// #4430 item 6: native variant. A screen hides its footer without unmounting
// it (and without resizing the scroll frame).
// #4508 round 9: read from keyboardVisibility.ts, not the library's
// useKeyboardState().isVisible, which a late keyboardDidHide leaves "closed"
// while the next keyboard is up (see that file). The app-wide Done bar reads
// this hook too, so every input gets its bar back after a picker closes.
import { useEffect, useState } from 'react';
import { KeyboardController, KeyboardEvents } from 'react-native-keyboard-controller';

import {
  KEYBOARD_VISIBILITY_EVENTS,
  nextKeyboardVisibility,
  type KeyboardVisibility,
} from './keyboardVisibility';

export function useKeyboardIsVisible(): boolean {
  const [state, setState] = useState<KeyboardVisibility>(() => {
    const visible = KeyboardController.isVisible();
    return { visible, showing: visible };
  });
  useEffect(() => {
    const subscriptions = KEYBOARD_VISIBILITY_EVENTS.map((event) =>
      KeyboardEvents.addListener(event, () =>
        setState((current) => nextKeyboardVisibility(current, event)),
      ),
    );
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return state.visible;
}
