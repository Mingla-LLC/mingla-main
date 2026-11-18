/**
 * hideModalFocusBrackets — keep react-native-web's Modal focus-trap sentinels
 * out of the accessibility tree.
 *
 * react-native-web's `Modal` wraps its content in a focus trap that renders two
 * EMPTY sentinel elements, `<div role="presentation" tabindex="0">`, one before
 * and one after the content. They must stay focusable (tabbing onto one is what
 * sends focus back inside the dialog), but a focusable element with no name is
 * announced as an unnamed control: every open sheet on web showed one beside the
 * labelled "Dismiss sheet" scrim button.
 *
 * `aria-hidden="true"` removes them from the accessibility tree and keeps them
 * as tab stops, which is the same treatment focus-trap libraries give their
 * sentinels. The function is a no-op off the DOM, so native passes through it
 * untouched. Attach it as the `ref` of the first View inside a `<Modal>`.
 */

interface BracketLike {
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  childElementCount?: number;
}

interface NodeLike {
  previousElementSibling?: BracketLike | null;
  nextElementSibling?: BracketLike | null;
  parentElement?: NodeLike | null;
}

const isBracket = (el: BracketLike | null | undefined): el is BracketLike =>
  el != null &&
  el.getAttribute("role") === "presentation" &&
  el.getAttribute("tabindex") === "0" &&
  (el.childElementCount ?? 0) === 0;

// The trap renders [bracket, content, bracket] as siblings; the caller's node
// sits somewhere inside "content", so climb until a level has bracket siblings.
const MAX_CLIMB = 8;

export const hideModalFocusBrackets = (node: unknown): void => {
  let el = (node ?? null) as NodeLike | null;
  for (let i = 0; el != null && i < MAX_CLIMB; i += 1) {
    const before = el.previousElementSibling;
    const after = el.nextElementSibling;
    if (isBracket(before) && isBracket(after)) {
      before.setAttribute("aria-hidden", "true");
      after.setAttribute("aria-hidden", "true");
      return;
    }
    el = el.parentElement ?? null;
  }
};
