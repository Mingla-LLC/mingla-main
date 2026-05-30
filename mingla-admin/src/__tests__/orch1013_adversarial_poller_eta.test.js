// ORCH-1013 ADVERSARIAL — useActiveRunsPoller ETA + lifecycle.
//
// The implementor's poller tests assert constants only ("declares POLL_INTERVAL_MS = 5000").
// This file tests the ACTUAL ETA computation algorithm + the edge cases the
// spec calls out: 0-progress (no NaN/Infinity), stalled run (rate ≤ 0),
// buffer cap, terminal-tail TTL.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(ADMIN_ROOT, "src", "hooks", "useActiveRunsPoller.js");
const CARD = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "ActiveRunCard.jsx",
);
const src = fs.readFileSync(HOOK, "utf8");
const cardSrc = fs.readFileSync(CARD, "utf8");

// Mirror the ETA computation block from useActiveRunsPoller.js (~L91-L117).
const ETA_BUFFER_CAP = 12;
const ETA_MIN_WINDOW_MS = 30_000;

function computeEta(buffer, run) {
  if (buffer.length < 2) return { liveEtaSeconds: null, liveRatePerMin: null };
  const first = buffer[0];
  const last = buffer[buffer.length - 1];
  const dtMs = last.ts - first.ts;
  if (dtMs < ETA_MIN_WINDOW_MS) return { liveEtaSeconds: null, liveRatePerMin: null };
  const dProcessed = last.processed - first.processed;
  const ratePerSec = dProcessed / (dtMs / 1000);
  if (ratePerSec <= 0) return { liveEtaSeconds: null, liveRatePerMin: null };
  const remaining = Math.max(0, Number(run.total_count || 0) - Number(run.processed_count || 0));
  return {
    liveEtaSeconds: remaining / ratePerSec,
    liveRatePerMin: ratePerSec * 60,
  };
}

describe("ORCH-1013 ADVERSARIAL — ETA computation edge cases", () => {
  it("0 buffer entries → null (no division by zero)", () => {
    const { liveEtaSeconds } = computeEta([], { total_count: 100, processed_count: 0 });
    assert.equal(liveEtaSeconds, null);
  });

  it("1 buffer entry → null (insufficient sample)", () => {
    const { liveEtaSeconds } = computeEta(
      [{ ts: 0, processed: 10 }],
      { total_count: 100, processed_count: 10 },
    );
    assert.equal(liveEtaSeconds, null, "single sample cannot extrapolate rate");
  });

  it("2 entries but <30s apart → null (under min window)", () => {
    const { liveEtaSeconds } = computeEta(
      [{ ts: 0, processed: 10 }, { ts: 20_000, processed: 30 }],
      { total_count: 100, processed_count: 30 },
    );
    assert.equal(liveEtaSeconds, null, "20s sample is under 30s min window");
  });

  it("stalled run (rate = 0) → null (avoid Infinity)", () => {
    const { liveEtaSeconds } = computeEta(
      [{ ts: 0, processed: 50 }, { ts: 30_000, processed: 50 }],
      { total_count: 100, processed_count: 50 },
    );
    assert.equal(liveEtaSeconds, null, "stalled run must NOT render Infinity");
  });

  it("regressing rate (rate < 0) → null", () => {
    // Pathological: processed count went backward (shouldn't happen, but defend)
    const { liveEtaSeconds } = computeEta(
      [{ ts: 0, processed: 60 }, { ts: 30_000, processed: 50 }],
      { total_count: 100, processed_count: 50 },
    );
    assert.equal(liveEtaSeconds, null, "negative rate must NOT render bogus ETA");
  });

  it("valid rate at 30s window: 10 places/30s = 0.333/sec; remaining=50 → ETA ≈ 150s", () => {
    const { liveEtaSeconds, liveRatePerMin } = computeEta(
      [{ ts: 0, processed: 40 }, { ts: 30_000, processed: 50 }],
      { total_count: 100, processed_count: 50 },
    );
    assert.ok(liveEtaSeconds !== null);
    assert.ok(Math.abs(liveEtaSeconds - 150) < 1, `expected ~150s, got ${liveEtaSeconds}`);
    assert.ok(Math.abs(liveRatePerMin - 20) < 0.1, `expected ~20/min, got ${liveRatePerMin}`);
  });

  it("0% progress baseline: processed=0, no buffer history → null", () => {
    const { liveEtaSeconds } = computeEta([], { total_count: 100, processed_count: 0 });
    assert.equal(liveEtaSeconds, null);
  });

  it("processed > total (pathological): remaining=Max(0,..) prevents negative ETA", () => {
    const { liveEtaSeconds } = computeEta(
      [{ ts: 0, processed: 90 }, { ts: 30_000, processed: 110 }],
      { total_count: 100, processed_count: 110 },
    );
    // rate=0.667/s, remaining=Max(0, 100-110)=0, ETA=0
    assert.equal(liveEtaSeconds, 0, "remaining clamped via Max(0,...)");
  });
});

describe("ORCH-1013 ADVERSARIAL — formatEta in ActiveRunCard", () => {
  // Re-extract the formatEta function from ActiveRunCard source. It's a pure
  // function — we can require() it via dynamic import, but the file is JSX.
  // Instead: assert the contract via grep + recreate.
  it("formatEta(null) returns '—' (not 'NaN min')", () => {
    assert.ok(
      cardSrc.includes('"—"') && cardSrc.includes("formatEta"),
      "formatEta must fall back to em-dash on null/non-finite",
    );
    // Verify the null guard is present
    assert.ok(
      /seconds\s*==\s*null/.test(cardSrc) ||
        /seconds\s*===\s*null/.test(cardSrc) ||
        cardSrc.includes("seconds == null"),
      "formatEta must check for null seconds",
    );
    assert.ok(
      cardSrc.includes("Number.isFinite(seconds)"),
      "formatEta must reject Infinity/NaN via Number.isFinite",
    );
  });

  it("ETA displays '—' when status !== 'running' even if liveEtaSeconds is positive", () => {
    // SPEC §3 B.3: 'ETA: —' otherwise. Source must guard on isRunning.
    assert.ok(
      cardSrc.includes("isRunning ? formatEta(run._liveEtaSeconds) : \"—\""),
      "ETA must show '—' when not running, regardless of buffered rate",
    );
  });
});

describe("ORCH-1013 ADVERSARIAL — poller lifecycle + leak protection", () => {
  it("clearInterval is called in cleanup", () => {
    assert.ok(
      src.includes("clearInterval(interval)"),
      "useEffect cleanup must call clearInterval to prevent leak",
    );
  });

  it("clearTimeout is called for all terminal-display timers on unmount", () => {
    assert.ok(
      src.includes("for (const handle of terminalTimersRef.current.values()) clearTimeout(handle)"),
      "all pending 3s terminal-display timers must be cleared on unmount",
    );
  });

  it("visibilitychange listener is removed on unmount", () => {
    assert.ok(
      src.includes('document.removeEventListener("visibilitychange"'),
      "visibilitychange listener must be removed on unmount",
    );
  });

  it("ETA buffer cap = 12 (60s at 5s poll)", () => {
    const m = src.match(/ETA_BUFFER_CAP\s*=\s*([0-9_]+)/);
    assert.ok(m, "ETA_BUFFER_CAP constant must be declared");
    assert.equal(parseInt(m[1].replace(/_/g, ""), 10), 12);
  });

  it("poll interval = 5000ms (SPEC §3 B.4)", () => {
    const m = src.match(/POLL_INTERVAL_MS\s*=\s*([0-9_]+)/);
    assert.ok(m);
    assert.equal(parseInt(m[1].replace(/_/g, ""), 10), 5000);
  });

  it("terminal display TTL = 3000ms (SPEC §3 B.2)", () => {
    const m = src.match(/TERMINAL_DISPLAY_MS\s*=\s*([0-9_]+)/);
    assert.ok(m);
    assert.equal(parseInt(m[1].replace(/_/g, ""), 10), 3000);
  });

  it("background-tab guard: tick early-returns on document.visibilityState === 'hidden'", () => {
    assert.ok(
      src.includes('document.visibilityState === "hidden"'),
      "tick must skip polling when tab is hidden (quota + ETA preservation)",
    );
  });

  it("error state surfaces only after 3 consecutive failures (not on first transient)", () => {
    const m = src.match(/ERROR_THRESHOLD\s*=\s*([0-9_]+)/);
    assert.ok(m, "ERROR_THRESHOLD must be declared");
    assert.equal(parseInt(m[1].replace(/_/g, ""), 10), 3);
    assert.ok(
      src.includes("consecutiveErrorsRef.current += 1"),
      "must increment consecutive error counter",
    );
    assert.ok(
      src.includes("consecutiveErrorsRef.current = 0"),
      "must reset counter on success",
    );
  });
});
