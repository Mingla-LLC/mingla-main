/**
 * #3187 — installed-app attribution for a share that points at a canonical page.
 *
 * WHY THIS EXISTS. A share used to point at `usemingla.com/s/<code>`. With the
 * app installed, that link opens `app/s/[code].tsx`, which resolves the code,
 * persists `{shortCode, version}` for the post-sign-in identified activation,
 * and records `share_native_opened` — then routes to the offering's own screen.
 * A share now points at the page itself (`host.usemingla.com/e/…?ms=…`), which
 * the app ALSO claims (host AASA `/b/* /e/* /t/* /exp/*`), so the app opens the
 * offering's screen directly and `/s/` never runs. Without this, both the
 * attribution and the event would silently stop for every recipient who has
 * the app. This records them exactly as `/s/` does, from the `ms` param.
 *
 * The code is resolved through the same `readContentShare` read `/s/` uses, so
 * a forged or revoked code is rejected rather than persisted, and the recorded
 * version is the one the server serves — identical semantics to `/s/`.
 *
 * Never throws and never blocks rendering: the screen renders from its own
 * route params whatever happens here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseShareAttributionValue } from '@mingla/sharing';
import { ContentShareReadError, readContentShare, type ContentShareRead } from './contentShareService';
import { persistContentShareAttribution, type ContentShareAttributionStorage } from './contentShareAttribution';
import { mixpanelService } from './mixpanelService';
import { logAppsFlyerEvent } from './appsFlyerService';

export type CanonicalShareArrivalOutcome = 'ignored' | 'recorded' | 'failed';

type ArrivalEvent = 'share_native_opened' | 'share_failure';

export type CanonicalShareArrivalDeps = {
  read: (code: string) => Promise<ContentShareRead>;
  storage: ContentShareAttributionStorage;
  capture: (event: ArrivalEvent, properties: Record<string, string | number | boolean>) => void;
};

const defaultCapture = (event: ArrivalEvent, properties: Record<string, string | number | boolean>): void => {
  try { mixpanelService.track(event, properties); } catch { /* telemetry never owns navigation */ }
  try { logAppsFlyerEvent(event, properties); } catch { /* telemetry never owns navigation */ }
};

const defaultDeps: CanonicalShareArrivalDeps = {
  read: readContentShare,
  storage: AsyncStorage,
  capture: defaultCapture,
};

/**
 * Records the arrival for one raw `ms` value. Anything that is not a valid
 * `<code>.<version>` is ignored with no network call and no event.
 */
export async function recordCanonicalShareArrival(
  raw: unknown,
  deps: CanonicalShareArrivalDeps = defaultDeps,
): Promise<CanonicalShareArrivalOutcome> {
  const attribution = parseShareAttributionValue(raw);
  if (attribution === null) return 'ignored';
  try {
    const share = await deps.read(attribution.code);
    await persistContentShareAttribution(deps.storage, { shortCode: share.shortCode, version: share.version });
    deps.capture('share_native_opened', {
      kind: share.facts.kind,
      version: share.version,
      short_code: share.shortCode,
      recipient_app: 'consumer',
      recipient_surface: 'native_content_share',
      outcome: 'resolved',
      share_entry: 'canonical_page',
    });
    return 'recorded';
  } catch (error: unknown) {
    const reason = error instanceof ContentShareReadError ? error.code : 'temporarily_unavailable';
    deps.capture('share_failure', {
      failure_type: 'resolver',
      reason,
      recipient_app: 'consumer',
      recipient_surface: 'native_content_share',
      share_entry: 'canonical_page',
    });
    return 'failed';
  }
}
