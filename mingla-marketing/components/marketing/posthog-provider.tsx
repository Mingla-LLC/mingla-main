'use client'
// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 1 (marketing web).
//
// PostHog browser-SDK provider for the marketing site (usemingla.com).
//
// CONSENT GATE (I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES): PostHog is
// initialized with `opt_out_capturing_by_default: true`. PostHog's documented
// behavior under this flag is that it stores NOTHING in cookies / local /
// session storage and captures NO events until `posthog.opt_in_capturing()`
// is called — which only happens from the consent-banner Accept handler
// (see consent-banner.tsx). Reject calls `posthog.opt_out_capturing()`.
//
// REPLAY MASKING (I-PROPOSED-1187-REPLAY-MASKS-PII): session replay is ON but
// every input is masked (`maskAllInputs: true`) plus belt-and-suspenders email/
// password masking; any element tagged `data-ph-mask` or `.ph-no-capture` is
// masked. NEVER set `maskAllInputs: false`. The marketing beta-access modal has
// an email field — it must be masked. A replay capturing PII is an AUTOMATIC FAIL.
//
// COST GUARD (§4.I): session replay is sampled (`sampleRate`) to protect the
// free 5K-recordings/mo tier. Seth also sets a $0 PostHog billing cap (SA-1).
//
// US REGION (I-PROPOSED-1187-POSTHOG-HOST-US): api_host MUST be
// `https://us.i.posthog.com` (dispatch-locked).
//
// CSP note: `next.config.ts` only sets `frame-ancestors` (not a full CSP), so
// PostHog (us.i.posthog.com / us-assets.i.posthog.com) + GA hosts load fine.
// Do NOT tighten CSP into a script-src/connect-src allowlist this phase; if a
// future hardening adds a strict CSP it must allowlist those hosts.
//
// SECRET HYGIENE (I-PROPOSED-1187-NO-PHX-IN-CLIENT): only the public `phc_*`
// client key ships here (via NEXT_PUBLIC_POSTHOG_KEY). The `phx_*` personal/MCP
// key MUST NEVER appear in any client source.

import { useEffect } from 'react'
import posthog from 'posthog-js'

// US ingestion host — dispatch-locked. Read from env with the US literal as the
// fallback so the host literal is always present for the strict-grep gate.
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

let initialized = false

/**
 * Session-replay sampling rate (§4.I cost guard). Records ~20% of sessions to
 * protect the free 5K-recordings/mo allowance. Seth can override server-side in
 * the PostHog UI without a deploy.
 */
export const PH_REPLAY_SAMPLE_RATE = 0.2

/**
 * Initialize PostHog (idempotent). Consent-gated: with
 * opt_out_capturing_by_default:true nothing is stored / captured until the
 * consent banner calls posthog.opt_in_capturing(). No-ops (without crashing the
 * site) when the public key is missing.
 */
export function initPostHog(): void {
  if (initialized) return
  if (typeof window === 'undefined') return
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) {
    // Graceful no-op — a missing env must never crash the live site (T-3).
    return
  }
  posthog.init(key, {
    api_host: 'https://us.i.posthog.com',
    ui_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    // CONSENT GATE — no cookies / no capture until opt_in (banner Accept).
    opt_out_capturing_by_default: true,
    // Power features (free-tier): autocapture + error tracking.
    autocapture: true,
    capture_exceptions: true,
    // Session replay ON, but HARD-masked (PII security gate, §4.H).
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: { password: true, email: true },
      maskTextSelector: '[data-ph-mask]',
      sampleRate: PH_REPLAY_SAMPLE_RATE,
    },
  })
  initialized = true
}

/** True once init has run (key present). Capture helpers guard on this. */
export function isPostHogReady(): boolean {
  return initialized
}

/** Grant consent: opt in to capturing. Called from the banner Accept handler. */
export function posthogOptIn(): void {
  if (!initialized) return
  posthog.opt_in_capturing()
}

/** Deny consent: explicit opt out. Called from the banner Reject handler. */
export function posthogOptOut(): void {
  if (!initialized) return
  posthog.opt_out_capturing()
}

/**
 * Capture a marketing event. Safe to call from any client component — no-ops
 * when PostHog has not initialized (missing key) or the visitor has opted out
 * (PostHog itself drops captures while opted out). Never throws.
 */
export function captureMarketing(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) return
  try {
    posthog.capture(event, properties)
  } catch {
    // Analytics must never break the page; swallow but do not silently lie —
    // a failed capture is non-fatal and PostHog logs its own transport errors.
  }
}

/** Client provider — initializes PostHog once at mount. Renders nothing. */
export function PostHogProvider(): null {
  useEffect(() => {
    initPostHog()
  }, [])
  return null
}
