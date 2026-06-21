// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 web stub.
//
// WEB NO-OP STUB for the native postHogService. Metro's platform resolution
// picks this `.web.ts` over `postHogService.ts` on the buyer-web export, so the
// native `posthog-react-native` SDK NEVER enters the web bundle (it is a native
// module that blows the ORCH-1083 __common initial-bundle budget guard).
//
// Mirrors the EXISTING mixpanelService.web.ts no-op pattern. Web analytics is
// owned entirely by Leg 2's webAnalytics.web.ts — this stub only makes the
// NATIVE PostHog facade inert on web while preserving the SAME public interface
// (same named/default exports, same method signatures) so TypeScript and the
// native callers are unaffected. Imports NOTHING from posthog-react-native.
//
// Preserves I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS.

/**
 * Flat, JSON-serializable analytics property bag — kept structurally identical
 * to the native facade so call sites typecheck the same on web.
 */
type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

// Mirror the native export (web replay sampling is irrelevant; value preserved
// so any consumer reading the constant resolves the same shape).
export const PH_REPLAY_SAMPLE_RATE = 0.2;

class PostHogService {
  private static instance: PostHogService | null = null;

  static getInstance(): PostHogService {
    if (PostHogService.instance === null) {
      PostHogService.instance = new PostHogService();
    }
    return PostHogService.instance;
  }

  isReady(): boolean {
    return false;
  }

  getClient(): null {
    return null;
  }

  async initialize(): Promise<void> {
    // no-op on web
  }

  identify(_userId: string, _properties?: AnalyticsProps): void {
    // no-op on web
  }

  capture(_event: string, _properties?: AnalyticsProps): void {
    // no-op on web
  }

  reset(): void {
    // no-op on web
  }

  optOut(): void {
    // no-op on web
  }

  optIn(): void {
    // no-op on web
  }

  getFeatureFlag(_key: string): boolean | string | undefined {
    return undefined;
  }
}

export const postHogService = PostHogService.getInstance();
export { PostHogService };
