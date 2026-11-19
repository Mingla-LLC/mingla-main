/**
 * #4226 phase 2B — People journey tracking (Explorer app).
 *
 * Three fire-and-forget writes that feed the admin People screen:
 *   - record_journey_mark: which onboarding step a person is on (monotonic on
 *     the server, so it is safe to call on every step view).
 *   - record_signup_source: how a new account found Mingla (first write wins).
 *   - record_install_attribution: the AppsFlyer install conversion data for
 *     this phone, saved once the user is known.
 *
 * Tracking must never block or break the UI: every call is void, every failure
 * is logged (Constitution 3) and never shown (Constitution 1 does not apply, no
 * user action depends on it). Sign-out clears everything held (Constitution 6).
 *
 * This module imports only `./supabase` and AsyncStorage so it can be loaded
 * and tested on its own.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

export type JourneyKind = 'explorer_onboarding' | 'host_brand_setup'

export type SignupSource =
  | 'friend_invite'
  | 'collab_invite'
  | 'ticket_link'
  | 'host_invite'
  | 'referral_link'
  | 'web_ticket_first'
  | 'paid_ad'
  | 'app_store'
  | 'website'
  | 'organic'
  | 'unknown'

/** The appsflyer_devices.app value this app already writes. */
export const PEOPLE_JOURNEY_APP = 'consumer'
export const PEOPLE_JOURNEY_SURFACE = 'explorer_app'
export const SIGNUP_SOURCE_SENT_KEY_PREFIX = '@mingla_signup_source_sent_v1:'

type Detail = Record<string, string | number | boolean>

function warn(what: string, error: unknown): void {
  console.warn(`[peopleJourney] ${what}`, error)
}

/** Calls an RPC and logs any failure. Resolves true only on success. Never throws. */
async function callRpc(name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await supabase.rpc(name, args)
    if (error) {
      warn(`${name} failed:`, error.message ?? error)
      return false
    }
    return true
  } catch (e) {
    warn(`${name} threw:`, e)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Journey marks
// ─────────────────────────────────────────────────────────────────────────────

const sentMarks = new Set<string>()

/**
 * Record that the person is viewing a step. Once per kind+step+key per session
 * (the server is monotonic, so a repeat adds nothing); a failed write is
 * allowed to retry on the next view.
 */
export function recordJourneyMark(kind: JourneyKind, step: number, stepKey: string): void {
  const id = `${kind}:${step}:${stepKey}`
  if (sentMarks.has(id)) return
  sentMarks.add(id)
  void callRpc('record_journey_mark', {
    p_kind: kind,
    p_step: step,
    p_step_key: stepKey,
  }).then((ok) => {
    if (!ok) sentMarks.delete(id)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Install conversion data (AppsFlyer)
// ─────────────────────────────────────────────────────────────────────────────

export type InstallConversion = Record<string, unknown>

let heldConversion: InstallConversion | null = null
const attributionSentFor = new Set<string>()
let attributionInFlight = false

function jsonSafe(data: InstallConversion): InstallConversion | null {
  try {
    return JSON.parse(JSON.stringify(data)) as InstallConversion
  } catch (e) {
    warn('conversion data not serialisable:', e)
    return null
  }
}

/** Hold the conversion data in memory until the user is known. */
export function holdInstallConversion(data: InstallConversion | null | undefined): void {
  if (!data || typeof data !== 'object') return
  const safe = jsonSafe(data)
  if (safe) heldConversion = safe
}

export function dropHeldInstallConversion(): void {
  heldConversion = null
}

export function getHeldInstallConversion(): InstallConversion | null {
  return heldConversion
}

export type InstallAttributionResult = 'sent' | 'held' | 'skipped' | 'failed'

/** At most this many tries per app session; a held payload is not retried after. */
export const MAX_ATTRIBUTION_ATTEMPTS = 3
let attributionAttempts = 0
let attributionRerun = false

/**
 * Send the held conversion data once for this user. Needs the signed-in user
 * and this phone's AppsFlyer id; with either missing (or nothing held) it stays
 * held. Opted-out people send nothing and nothing is kept.
 *
 * The server upserts the device row itself and answers true (written) or false
 * (already recorded earlier); both mean handled and clear the held payload. An
 * error, or an answer that is not a boolean ("no error, no rows"), is NOT sent:
 * the payload stays held and the next auth or foreground event retries, up to
 * MAX_ATTRIBUTION_ATTEMPTS per app session.
 */
export async function sendHeldInstallAttribution(ctx: {
  userId: string | null
  appsflyerId: string | null
  optedOut: boolean
}): Promise<InstallAttributionResult> {
  if (ctx.optedOut) {
    heldConversion = null
    return 'skipped'
  }
  if (!ctx.userId || !ctx.appsflyerId || !heldConversion) return 'held'
  if (attributionSentFor.has(ctx.userId)) return 'skipped'
  if (attributionInFlight) {
    attributionRerun = true
    return 'skipped'
  }
  if (attributionAttempts >= MAX_ATTRIBUTION_ATTEMPTS) return 'skipped'
  attributionAttempts += 1
  attributionInFlight = true
  const payload = heldConversion
  let handled = false
  try {
    try {
      const { data, error } = await supabase.rpc('record_install_attribution', {
        p_appsflyer_id: ctx.appsflyerId,
        p_app: PEOPLE_JOURNEY_APP,
        p_payload: payload,
      })
      if (error) {
        warn('record_install_attribution failed:', error.message ?? error)
      } else if (data === true || data === false) {
        handled = true
      } else {
        warn('record_install_attribution gave no answer; keeping it held', data)
      }
    } catch (e) {
      warn('record_install_attribution threw:', e)
    }
    if (handled) {
      attributionSentFor.add(ctx.userId)
      if (heldConversion === payload) heldConversion = null
    }
    return handled ? 'sent' : 'failed'
  } finally {
    attributionInFlight = false
    if (!handled && attributionRerun && attributionAttempts < MAX_ATTRIBUTION_ATTEMPTS) {
      attributionRerun = false
      void sendHeldInstallAttribution(ctx)
    }
    attributionRerun = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-up source
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceHints {
  /** A held friend invite or personal invite link (friend_invite / friend_share). */
  friendInvite: boolean
  /** A held group link, or a pending collaboration invite / trip-chat claim. */
  collabInvite: boolean
  /** Signed up through a ticket link (the ticket-first onboarding). */
  ticketLink: boolean
  /** A referral code from a OneLink was saved on this phone. */
  referralLink: boolean
}

export const EMPTY_SOURCE_HINTS: SourceHints = {
  friendInvite: false,
  collabInvite: false,
  ticketLink: false,
  referralLink: false,
}

function field(data: InstallConversion, key: string): string | null {
  const v = data[key]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 120) : null
}

/**
 * Pure. Order (first match wins): friend invite, collab invite, ticket link,
 * referral link, AppsFlyer (Non-organic = paid_ad, Organic = organic), unknown.
 * No personal data goes in the detail.
 */
export function deriveSignupSource(
  hints: SourceHints,
  conversion: InstallConversion | null,
  optedOut: boolean,
): { source: SignupSource; detail: Detail } {
  if (hints.friendInvite) return { source: 'friend_invite', detail: {} }
  if (hints.collabInvite) return { source: 'collab_invite', detail: {} }
  if (hints.ticketLink) return { source: 'ticket_link', detail: {} }
  if (hints.referralLink) return { source: 'referral_link', detail: { has_code: true } }
  if (!optedOut && conversion) {
    const status = (field(conversion, 'af_status') ?? '').toLowerCase()
    if (status === 'non-organic') {
      const detail: Detail = {}
      const media = field(conversion, 'media_source')
      const campaign = field(conversion, 'campaign')
      if (media) detail.media_source = media
      if (campaign) detail.campaign = campaign
      return { source: 'paid_ad', detail }
    }
    if (status === 'organic') return { source: 'organic', detail: { af_status: 'Organic' } }
  }
  return { source: 'unknown', detail: {} }
}

/** Hints seen so far this session; merged (OR) so a claimed invite is not forgotten. */
let hintSnapshot: SourceHints = { ...EMPTY_SOURCE_HINTS }

export function noteSourceHints(partial: Partial<SourceHints>): void {
  hintSnapshot = {
    friendInvite: hintSnapshot.friendInvite || partial.friendInvite === true,
    collabInvite: hintSnapshot.collabInvite || partial.collabInvite === true,
    ticketLink: hintSnapshot.ticketLink || partial.ticketLink === true,
    referralLink: hintSnapshot.referralLink || partial.referralLink === true,
  }
}

export function getSourceHints(): SourceHints {
  return { ...hintSnapshot }
}

const signupSourceDone = new Set<string>()

/**
 * Record the sign-up source once for this account. First write wins on the
 * server; here a per-session set plus a saved flag stop repeat calls. A failed
 * write is retried on the next call.
 */
export async function recordSignupSourceOnce(input: {
  userId: string
  hints: Partial<SourceHints>
  optedOut: boolean
}): Promise<void> {
  const { userId } = input
  if (!userId || signupSourceDone.has(userId)) return
  signupSourceDone.add(userId)
  try {
    const flagKey = `${SIGNUP_SOURCE_SENT_KEY_PREFIX}${userId}`
    try {
      if ((await AsyncStorage.getItem(flagKey)) === '1') return
    } catch (e) {
      warn('signup source flag unreadable:', e)
    }
    noteSourceHints(input.hints)
    const { source, detail } = deriveSignupSource(
      getSourceHints(),
      heldConversion,
      input.optedOut,
    )
    const ok = await callRpc('record_signup_source', {
      p_source: source,
      p_detail: detail,
      p_surface: PEOPLE_JOURNEY_SURFACE,
    })
    if (!ok) {
      signupSourceDone.delete(userId)
      return
    }
    try {
      await AsyncStorage.setItem(flagKey, '1')
    } catch (e) {
      warn('signup source flag not saved:', e)
    }
  } catch (e) {
    signupSourceDone.delete(userId)
    warn('recordSignupSourceOnce threw:', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-out (Constitution 6)
// ─────────────────────────────────────────────────────────────────────────────

/** Drops everything held for the signed-in person. Idempotent. */
export function clearPeopleJourneyState(): void {
  sentMarks.clear()
  heldConversion = null
  attributionSentFor.clear()
  attributionInFlight = false
  attributionAttempts = 0
  attributionRerun = false
  hintSnapshot = { ...EMPTY_SOURCE_HINTS }
  signupSourceDone.clear()
}
