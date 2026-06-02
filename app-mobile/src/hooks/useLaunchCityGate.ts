/**
 * useLaunchCityGate — ORCH-1028 Part 1 (launch-city gate) network wrapper.
 *
 * Calls the ORCH-1027 `check-launch-city` edge function with the device GPS
 * point captured in onboarding Step 3 and resolves a single terminal decision
 * the location step branches on.
 *
 * The (body,error)→result decision + the coordinate guard live in the
 * dependency-free `launchCityGateLogic.ts` so they are directly unit-testable
 * (§F.1). This file only adds the network call + 6s timeout + logging.
 *
 * CONTRACT OWNER: ORCH-1027. Response types mirror its FROZEN §C.3 shape exactly —
 * do NOT widen them without re-coordinating (I-1028-CONTRACT-CONSUMED).
 *
 * NEVER throws (SPEC §A.1 / I-1028-NEVER-STRANDED): the location step must always
 * receive a terminal `LaunchGateResult` so it can decide to advance or branch.
 */
import { supabase } from '../services/supabase'
import { withTimeout } from '../utils/withTimeout'
import { logger } from '../utils/logger'
import {
  resolveLaunchGate,
  areCoordsValid,
  type LaunchGateResult,
} from './launchCityGateLogic'

export type {
  LaunchCity,
  LaunchCityWithBbox,
  CheckLaunchCityResponse,
  LaunchGateResult,
  LaunchCityOverride,
} from './launchCityGateLogic'
export { buildLaunchCityOverride, resolveLaunchGate, areCoordsValid } from './launchCityGateLogic'

const CHECK_TIMEOUT_MS = 6000

/**
 * Resolve the launch-city gate decision for a captured GPS point.
 * Always resolves (never rejects). On any failure → { status: 'check_failed' }.
 */
export async function checkLaunchCity(lat: number, lng: number): Promise<LaunchGateResult> {
  // Defensive input validation — the captured GPS point is always finite, but a
  // malformed call must NOT hit the network and must NOT throw.
  if (!areCoordsValid(lat, lng)) {
    logger.onboarding('Launch-city gate: invalid coordinates, skipping check', { lat, lng })
    return { status: 'check_failed' }
  }

  try {
    const { data, error } = await withTimeout(
      supabase.functions.invoke('check-launch-city', { body: { lat, lng } }),
      CHECK_TIMEOUT_MS,
      'check-launch-city'
    )

    const result = resolveLaunchGate(data, error)
    if (result.status === 'check_failed') {
      logger.onboarding('Launch-city gate: check_failed', {
        hasError: !!error,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      })
    }
    return result
  } catch (e: unknown) {
    // Timeout / thrown / anything → check_failed. Never propagate.
    logger.onboarding('Launch-city gate: check threw', {
      error: e instanceof Error ? e.message : String(e),
    })
    return { status: 'check_failed' }
  }
}
