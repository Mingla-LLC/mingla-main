/**
 * #4271 — warm the reader up so Apple's tap screen opens within a second.
 *
 * Runs at launch and each time the app comes to the foreground, at most once a
 * minute, and only for a brand that set up on this phone. No hint means no
 * warm-up, so someone who never set up gets no location prompt at launch.
 *
 * It never allows Apple's terms and never shows anything: a failure is reported
 * as non-fatal and the next sale simply connects for itself.
 */
export const TAP_WARM_THROTTLE_MS = 60_000;

export interface TapToPayWarmUpDeps {
  isLive(): boolean;
  readHint(): Promise<boolean>;
  fetchLocation(): Promise<string>;
  connect(locationId: string, options: { mayAcceptTerms: false }): Promise<{ error?: unknown }>;
  now(): number;
  report(scope: string, error: unknown): void;
}

export class TapToPayWarmUp {
  private lastAttemptAt: number | null = null;

  constructor(private readonly deps: TapToPayWarmUpDeps) {}

  /** Returns true when it actually tried to connect. */
  async trigger(): Promise<boolean> {
    const { deps } = this;
    if (!deps.isLive()) return false;
    const now = deps.now();
    if (this.lastAttemptAt !== null && now - this.lastAttemptAt < TAP_WARM_THROTTLE_MS) return false;
    try {
      if (!(await deps.readHint())) return false;
      this.lastAttemptAt = now;
      const locationId = await deps.fetchLocation();
      const { error } = await deps.connect(locationId, { mayAcceptTerms: false });
      if (error !== undefined) deps.report("door-tap.warm-up", error);
      return true;
    } catch (error) {
      deps.report("door-tap.warm-up", error);
      return true;
    }
  }
}
