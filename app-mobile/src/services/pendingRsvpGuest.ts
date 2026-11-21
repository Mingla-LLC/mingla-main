/**
 * issue #4508 1.16 — hold an RSVP guest link code ("{Inviter} saved you a
 * spot") through the store install, sign-up and onboarding, the way
 * pendingFriendInvite.ts holds a friend invite: memory + AsyncStorage, dropped
 * after 30 days. The shell reopens the claim screen once the person is signed
 * in and onboarded.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeRsvpGuestCode } from "../utils/rsvpGuestClaim";

const KEY = "mingla_pending_rsvp_guest_v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PendingRsvpGuest {
  code: string;
  ts: number;
}

let memory: PendingRsvpGuest | null = null;

export async function setPendingRsvpGuest(rawCode: string): Promise<void> {
  const code = normalizeRsvpGuestCode(rawCode);
  if (code === null) return;
  memory = { code, ts: Date.now() };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  } catch (e) {
    console.warn("[pendingRsvpGuest] persist failed", e);
  }
}

export async function clearPendingRsvpGuest(): Promise<void> {
  memory = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn("[pendingRsvpGuest] clear failed", e);
  }
}

/** The held code, or null (none, malformed or older than 30 days). */
export async function readPendingRsvpGuest(): Promise<PendingRsvpGuest | null> {
  if (memory !== null) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingRsvpGuest> | null;
    const code = normalizeRsvpGuestCode(parsed?.code);
    if (code === null || Date.now() - (parsed?.ts ?? 0) > MAX_AGE_MS) {
      await clearPendingRsvpGuest();
      return null;
    }
    memory = { code, ts: parsed?.ts ?? Date.now() };
    return memory;
  } catch (e) {
    console.warn("[pendingRsvpGuest] read failed", e);
    return null;
  }
}

/** Take the held code once (the shell opens the claim screen with it). */
export async function takePendingRsvpGuest(): Promise<string | null> {
  const held = await readPendingRsvpGuest();
  if (held === null) return null;
  await clearPendingRsvpGuest();
  return held.code;
}
