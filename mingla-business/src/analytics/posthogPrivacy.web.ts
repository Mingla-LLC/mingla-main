/**
 * posthogPrivacy.web.ts — #4238 P1-5 / P1-R4: PostHog's private-URL scrub.
 *
 * Loaded together with posthog-js (webAnalytics.web.ts bootAnalytics), before
 * posthog.init, so `before_send` and the stored first-page scrub are in place
 * before PostHog sends anything. Kept out of the eager web chunk: it is only
 * needed once PostHog itself is downloaded (#3493 boot payload).
 */
import type { CaptureResult, PostHog } from "posthog-js";
import { stripPrivateUrlProperties } from "../utils/privateUrlTokens";

/**
 * No PostHog event (custom, autocapture, exception, replay) carries a buyer
 * return page's private keys in any URL-bearing property.
 */
export function stripPrivateEventUrls(event: CaptureResult): CaptureResult {
  return {
    ...event,
    properties: stripPrivateUrlProperties(
      (event.properties ?? {}) as Record<string, unknown>,
    ) as CaptureResult["properties"],
    ...(event.$set
      ? { $set: stripPrivateUrlProperties(event.$set as Record<string, unknown>) }
      : {}),
    ...(event.$set_once
      ? {
          $set_once: stripPrivateUrlProperties(
            event.$set_once as Record<string, unknown>,
          ),
        }
      : {}),
  };
}

/**
 * PostHog stores the first page's address once (`$initial_person_info`) and
 * sends it as person properties with every flags request, which never passes
 * through before_send. Rewrite the stored copy without a buyer return page's
 * private keys, right after init (before the first flags request) and for a
 * copy persisted on an earlier visit.
 */
const POSTHOG_INITIAL_PERSON_INFO = "$initial_person_info";
const POSTHOG_CLIENT_SESSION_PROPS = "$client_session_props";

export function scrubPostHogInitialPersonInfo(posthog: PostHog): void {
  try {
    const persistence = posthog.persistence;
    if (persistence === undefined || persistence === null) return;
    const props = persistence.props as Record<string, unknown> | undefined;
    const updates: Record<string, unknown> = {};
    const info = props?.[POSTHOG_INITIAL_PERSON_INFO];
    if (info !== null && typeof info === "object") {
      const record = info as Record<string, unknown>;
      const next = stripPrivateUrlProperties(record);
      if (next.u !== record.u || next.r !== record.r) {
        updates[POSTHOG_INITIAL_PERSON_INFO] = next;
      }
    }
    // The per-session first page ({ sessionId, props: { r, u } }).
    const session = props?.[POSTHOG_CLIENT_SESSION_PROPS];
    if (session !== null && typeof session === "object") {
      const sessionRecord = session as Record<string, unknown>;
      const next = stripPrivateUrlProperties(sessionRecord);
      if (JSON.stringify(next) !== JSON.stringify(sessionRecord)) {
        updates[POSTHOG_CLIENT_SESSION_PROPS] = next;
      }
    }
    if (Object.keys(updates).length === 0) return;
    persistence.register(updates);
  } catch (err) {
    console.warn("[webAnalytics] PostHog initial URL scrub failed (non-fatal):", err);
  }
}
