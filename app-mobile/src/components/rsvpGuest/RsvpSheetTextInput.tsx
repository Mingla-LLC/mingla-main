/**
 * issue #4508 R2 — the text input the event page's RSVP guest fields use.
 *
 * The Explorer event page is a gorhom bottom sheet, so a plain TextInput in it
 * gets no keyboard handling: on a small iPhone the "By phone number" and
 * "Search friends" fields and the rows under them sat behind the keyboard.
 * This is the app's sheet pattern (see AttendanceClaimSheet, RsvpPartyInvites):
 * gorhom's `BottomSheetTextInput` (re-exported by BaseBottomSheet), so the
 * sheet rises with the keyboard. On focus it also asks the page to scroll the
 * field near the top of the sheet (`RsvpSheetFieldContext`), so the row
 * beneath it (the live preview, the first friends, the Add button) has room
 * above the keyboard too.
 *
 * Shared packages never import gorhom: the page injects this component into
 * the RSVP body (`guestInputComponent`) and into its phone field
 * (`inputComponent`).
 */

import React, { createContext, forwardRef, useCallback, useContext, useRef } from "react";
import type { TextInput, TextInputProps } from "react-native";

import { BottomSheetTextInput } from "../ui/BaseBottomSheet";

export interface RsvpSheetFieldHandlers {
  /** Scroll the sheet so this focused field sits near its top. */
  reveal: (field: unknown) => void;
  /** A guest field gained (true) or lost (false) focus. */
  onFocusChange: (focused: boolean) => void;
}

/** Provided by the event page around its RSVP body; absent ⇒ no scrolling. */
export const RsvpSheetFieldContext = createContext<RsvpSheetFieldHandlers | null>(null);

type FocusEvent = Parameters<NonNullable<TextInputProps["onFocus"]>>[0];
type BlurEvent = Parameters<NonNullable<TextInputProps["onBlur"]>>[0];

export const RsvpSheetTextInput = forwardRef<TextInput, TextInputProps>(
  function RsvpSheetTextInput({ onFocus, onBlur, ...rest }, ref) {
    const sheet = useContext(RsvpSheetFieldContext);
    const inner = useRef<TextInput | null>(null);
    const setRef = useCallback(
      // gorhom types its ref with gesture-handler's TextInput; the instance is
      // the react-native TextInput host, which is what callers get.
      (instance: unknown): void => {
        const node = (instance ?? null) as TextInput | null;
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref !== null) ref.current = node;
      },
      [ref],
    );
    const handleFocus = useCallback(
      (event: FocusEvent): void => {
        sheet?.onFocusChange(true);
        sheet?.reveal(inner.current);
        onFocus?.(event);
      },
      [sheet, onFocus],
    );
    const handleBlur = useCallback(
      (event: BlurEvent): void => {
        sheet?.onFocusChange(false);
        onBlur?.(event);
      },
      [sheet, onBlur],
    );
    return (
      <BottomSheetTextInput
        {...rest}
        ref={setRef}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    );
  },
);
