import { Linking, Platform } from "react-native";
import { openExternal } from "../services/guestFunnelLink";

/**
 * The ONE owner of "move the browser to a Studio or public-site URL" for the
 * Website workspace. #2830.
 *
 * WHY THIS EXISTS — proven at runtime against production on 2026-09-03.
 * The workspace previously handed `Linking.openURL` to the Studio handoff and
 * to the live-site action. On web, react-native-web's `Linking.openURL` calls:
 *
 *     window.open(url, "_blank", "noopener")
 *
 * Instrumenting the live page recorded exactly that call for Open Mingla
 * Studio, Preview draft AND View live website, each returning `null` with no
 * tab opened. A feature string — either `noopener` or `noreferrer` — is the
 * ORCH-1381 null-return trap that `issue2326CtaGesture` already forbids in the
 * checkout CTA; it reached this screen because this screen never used the
 * shared helper.
 *
 * There is a SECOND, independent cause on two of the three: Studio and Preview
 * open only AFTER awaiting a network mutation, so the tap's transient
 * activation is already spent when the URL is finally known, and a popup
 * blocker is entitled to refuse regardless of the feature string.
 *
 * `openExternal` answers both without needing to know which fired: no feature
 * string, `opener` still nulled for the security property, and a same-tab
 * `location.assign` fallback when the popup is genuinely blocked — so a
 * blocked open degrades to a navigation instead of a dead tap (Constitution
 * rule 1, "no dead taps").
 *
 * NATIVE IS DELIBERATELY UNCHANGED. iOS and Android were never broken — Seth
 * confirmed Studio and Preview open correctly on Business iOS on 2026-09-03 —
 * and `openExternal` is a DOM function with no meaning there.
 */
export function openWebsiteUrl(
  url: string,
  platform: string = Platform.OS,
): Promise<void> {
  if (platform === "web") {
    openExternal(url);
    return Promise.resolve();
  }
  return Linking.openURL(url);
}
