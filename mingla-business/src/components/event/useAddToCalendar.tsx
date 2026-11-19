/**
 * useAddToCalendar — issue #4420. The ONE entry point behind every buyer
 * "Add to calendar" control (event flyer, event body, RSVP body).
 *
 *   native  open() opens the Google Calendar page (Host app previews).
 *   web     open() opens the chooser: a sheet on phones, a small menu anchored
 *           to the tapped control on desktop. The chooser code loads on the
 *           first tap, not at boot (it is not on the eager boot payload).
 *
 * Anonymous-tolerant: never reads auth. Kept tiny on purpose: this file is on
 * the page's eager graph, so the chooser, the Sheet and every row live behind
 * the on-intent import (the boot payload gate counts every eager byte).
 */
import React, { useCallback, useState } from "react";
import { Platform } from "react-native";

import {
  offeringGoogleCalendarUrl,
  offeringOutlookCalendarUrl,
  type OfferingCalendarEntry,
} from "@mingla/offering-rendering/offeringCalendar.cjs";

import { addOfferingToCalendar } from "../../utils/offeringCalendarAction";
import type { MenuAnchor } from "../ui/Menu";
import type { AddToCalendarChooserProps } from "./AddToCalendarChooser";

const loadChooser = (): Promise<{ default: React.ComponentType<AddToCalendarChooserProps> }> =>
  import("./AddToCalendarChooser");

/**
 * The control that was just tapped, as page coordinates. Read synchronously
 * inside the tap (the click event is still `window.event`); null when the
 * browser does not expose it, and the chooser then shows as a sheet.
 */
export const readTriggerAnchor = (): MenuAnchor | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const current: Event | undefined = (window as Window & { event?: Event }).event;
  const target = current?.target as Element | null | undefined;
  if (target === null || target === undefined || typeof target.closest !== "function") return null;
  const trigger = target.closest('[role="button"],button,a') ?? target;
  const rect = trigger.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

export interface UseAddToCalendar {
  open: () => void;
  chooser: React.ReactElement | null;
}

export const useAddToCalendar = (
  entry: OfferingCalendarEntry | null,
  icsUrl: string | null,
  /** The chooser's code could not be fetched (offline, a stale deploy): tell the person. */
  onLoadError?: () => void,
): UseAddToCalendar => {
  const [visible, setVisible] = useState<boolean>(false);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [Chooser, setChooser] = useState<React.ComponentType<AddToCalendarChooserProps> | null>(null);

  const open = useCallback((): void => {
    if (entry === null) return;
    if (Platform.OS !== "web") {
      addOfferingToCalendar(entry);
      return;
    }
    setAnchor(readTriggerAnchor());
    setVisible(true);
    if (Chooser === null) {
      loadChooser().then(
        (module) => setChooser(() => module.default),
        (error: unknown) => {
          console.warn("[addToCalendar] could not load the calendar options", error);
          setVisible(false);
          onLoadError?.();
        },
      );
    }
  }, [Chooser, entry, onLoadError]);

  const close = useCallback((): void => setVisible(false), []);

  const chooser =
    Platform.OS === "web" && visible && Chooser !== null && entry !== null && icsUrl !== null
      ? React.createElement<AddToCalendarChooserProps>(Chooser, {
        visible,
        onClose: close,
        entry,
        icsUrl,
        googleUrl: offeringGoogleCalendarUrl(entry),
        outlookUrl: offeringOutlookCalendarUrl(entry),
        anchor,
      })
      : null;

  return { open, chooser };
};
