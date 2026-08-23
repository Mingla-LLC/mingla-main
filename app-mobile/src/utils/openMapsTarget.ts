// issue #2468 [maps-deep-link-coordinates] — the consumer app's ONE "open in
// maps" host effect.
//
// The URL itself is built by `@mingla/offering-rendering`'s `buildMapsDeepLink`
// (the single owner). This file owns only the RN side effect. No screen may
// compose a maps URL inline again.
import { Linking, Platform } from "react-native";

import {
  buildMapsDeepLink,
  type MapsOpenTarget,
} from "@mingla/offering-rendering";

export interface OpenMapsOptions {
  /**
   * Run a `Linking.canOpenURL` pre-flight before opening.
   *
   * DEFAULT false — and that default is deliberate, not laziness. Most call
   * sites here never had a pre-flight; they dispatched `openURL` synchronously.
   * Making the handler async by default would change WHEN the side effect
   * lands, which is exactly the kind of silent timing change that breaks
   * render tests and, worse, real double-tap behaviour. Pass `true` only where
   * a pre-flight already existed (#1605 added two of them).
   */
  preflight?: boolean;
  /** Surfaces the failure to the user (Constitution #3). */
  onUnavailable?: (() => void) | null;
}

/**
 * Open `target` in the device's maps app.
 *
 * Does nothing but call `onUnavailable` when the target holds neither a
 * coordinate nor a label — callers must already have disabled the control
 * (Constitution #1: no dead taps), so this is the belt-and-braces arm.
 *
 * Both paths end at `link.fallbackUrl`, which is always a real https URL. That
 * is what closes the #1605 dead-tap class for good: a device with no maps app
 * gets a browser instead of nothing, on every platform including web.
 */
export function openMapsTarget(
  target: MapsOpenTarget | null | undefined,
  options?: OpenMapsOptions,
): void {
  const onUnavailable = options?.onUnavailable;
  const link = buildMapsDeepLink({
    geo: target?.geo ?? null,
    label: target?.label ?? null,
    platform: Platform.OS,
  });
  if (link === null) {
    onUnavailable?.();
    return;
  }

  if (options?.preflight === true) {
    void (async () => {
      try {
        if (await Linking.canOpenURL(link.url)) {
          await Linking.openURL(link.url);
          return;
        }
      } catch {
        // Fall through: a rejected native scheme is not a reason to give the
        // user nothing.
      }
      try {
        await Linking.openURL(link.fallbackUrl);
      } catch {
        onUnavailable?.();
      }
    })();
    return;
  }

  void Linking.openURL(link.url).catch(() => {
    void Linking.openURL(link.fallbackUrl).catch(() => onUnavailable?.());
  });
}
