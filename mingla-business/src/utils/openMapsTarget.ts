// issue #2468 [maps-deep-link-coordinates] — the business app + buyer web's ONE "open in
// maps" host effect.
//
// The URL itself is built by `@mingla/offering-rendering`'s `buildMapsDeepLink`
// (the single owner). This file owns only the RN/RN-web side effect. No route may
// compose a maps URL inline again. WEB matters here: buildMapsDeepLink always
// returns a real https URL on web, where the old Platform.select({ios,android})
// returned undefined and the `if (url)` guard silently no-opped (#1605).
import { Linking, Platform } from "react-native";

import {
  buildMapsAppLink,
  buildMapsDeepLink,
  type MapsAppId,
  type MapsDeepLink,
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
  /**
   * issue #2508 — the map app the guest chose in the shared chooser.
   *
   * UNDEFINED means nothing was asked (only one app could honestly open this
   * target on this platform), and it takes the EXACT #2468 path — same builder,
   * same URL, byte for byte. That is why Android, which offers a single choice
   * because the `geo:` intent already lets the OS disambiguate, is completely
   * unchanged by #2508.
   *
   * The URL for a chosen app is still built by the ONE owner
   * (`buildMapsAppLink`); nothing is composed here.
   */
  app?: MapsAppId;
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
  const app = options?.app;
  // Both branches end at the same owner. The chosen-app branch keeps the
  // coordinate anchoring of #2468 intact: `buildMapsAppLink` anchors on the
  // stored pin whenever one exists, for EVERY app. The chooser picks the app,
  // never the accuracy.
  const link: MapsDeepLink | null =
    app === undefined
      ? buildMapsDeepLink({
          geo: target?.geo ?? null,
          label: target?.label ?? null,
          platform: Platform.OS,
        })
      : buildMapsAppLink({
          app,
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
