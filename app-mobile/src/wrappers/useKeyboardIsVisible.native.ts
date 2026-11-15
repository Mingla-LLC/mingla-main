// #4430 item 6: native variant. The library's own keyboard state, so a screen hides
// its footer without unmounting it (and without resizing the scroll frame).
import { useKeyboardState } from 'react-native-keyboard-controller';

export function useKeyboardIsVisible(): boolean {
  return useKeyboardState().isVisible;
}
