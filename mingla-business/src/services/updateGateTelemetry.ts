// #2107 (fix D) — every update-gate outcome reaches PostHog, so "everyone is on
// the latest version" becomes a number instead of an assumption.
//
// Byte-identical in app-mobile and mingla-business (parity-gated by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs).
//
// RULES THIS FILE HOLDS:
// - It goes through the app's EXISTING analytics wrapper (postHogService),
//   never a direct posthog-react-native import (strict-grep orch-1296).
// - The wrapper is required LAZILY inside a try/catch, so neither the gate
//   modules nor their unit tests pull the analytics graph in at eval time, and
//   a binary without the PostHog native module degrades to console only.
// - The gate decides before PostHog has initialised (it waits on the iOS ATT
//   prompt), so events are buffered and flushed once the client is ready.
//   Bounded buffer, bounded retries: telemetry can never hold memory or a timer
//   forever, and it can never throw into the gate.
// - The console report stays, so a device log still shows every outcome.

type TelemetryProps = Record<string, string | number | boolean | null>;

type AnalyticsFacade = {
  isReady: () => boolean;
  capture: (event: string, properties?: TelemetryProps) => void;
};

/** Only these prefixes are product events; everything else is console-only. */
const CAPTURED_PREFIXES = ["version_gate_", "critical_update_"] as const;
const MAX_BUFFERED = 50;
const FLUSH_RETRY_MS = 3_000;
const MAX_FLUSH_RETRIES = 40;

const buffer: Array<{ event: string; properties: TelemetryProps }> = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;

function loadFacade(): AnalyticsFacade | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./postHogService") as {
      postHogService?: Partial<AnalyticsFacade>;
    };
    const service = mod.postHogService;
    if (
      service !== undefined &&
      typeof service.isReady === "function" &&
      typeof service.capture === "function"
    ) {
      return service as AnalyticsFacade;
    }
    return null;
  } catch {
    return null;
  }
}

function flush(): void {
  retryTimer = null;
  const facade = loadFacade();
  if (facade !== null && facade.isReady()) {
    while (buffer.length > 0) {
      const next = buffer.shift();
      if (next === undefined) break;
      try {
        facade.capture(next.event, next.properties);
      } catch {
        // The facade never throws by contract; this is belt and braces.
      }
    }
    retries = 0;
    return;
  }
  if (buffer.length === 0) return;
  if (retries >= MAX_FLUSH_RETRIES) {
    console.warn(
      `[update-gate-telemetry] analytics never became ready; dropped ${buffer.length} event(s)`,
    );
    buffer.length = 0;
    retries = 0;
    return;
  }
  retries += 1;
  retryTimer = setTimeout(flush, FLUSH_RETRY_MS);
  // A telemetry retry must never be the thing that keeps a process alive. RN
  // timers have no unref; Node's (jest, scripts) do, and without it a buffered
  // event held a finished jest run open for 40 retries (~2 min) and then failed
  // it by requiring the analytics wrapper after the environment was torn down.
  (retryTimer as { unref?: () => void }).unref?.();
}

export function isCapturedUpdateGateEvent(event: string): boolean {
  return CAPTURED_PREFIXES.some((prefix) => event.startsWith(prefix));
}

export function reportUpdateGateEvent(
  channel: "app-version-policy" | "ota-update-gate",
  event: string,
  properties: TelemetryProps = {},
): void {
  try {
    console.warn(
      `[${channel}] ${event}${
        Object.keys(properties).length === 0 ? "" : ` ${JSON.stringify(properties)}`
      }`,
    );
    if (!isCapturedUpdateGateEvent(event)) return;
    if (buffer.length >= MAX_BUFFERED) buffer.shift();
    buffer.push({ event, properties });
    if (retryTimer === null) flush();
  } catch {
    // Telemetry must never break the gate it observes.
  }
}
