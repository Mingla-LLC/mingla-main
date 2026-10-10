/**
 * #3682 Wave 2.5 — in-memory + AsyncStorage hold for follow_invite OneLink token
 * until OTP verify / attach (design contract o).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "mingla_pending_follow_invite_v1";

export type PendingFollowInvite = {
  token: string;
  brandName?: string;
  brandSlug?: string;
  email?: string;
  ts: number;
};

let memory: PendingFollowInvite | null = null;
const listeners = new Set<(p: PendingFollowInvite | null) => void>();

function emit(): void {
  for (const l of listeners) l(memory);
}

export function subscribePendingFollowInvite(
  listener: (p: PendingFollowInvite | null) => void,
): () => void {
  listeners.add(listener);
  listener(memory);
  return () => {
    listeners.delete(listener);
  };
}

export function getPendingFollowInvite(): PendingFollowInvite | null {
  return memory;
}

export async function setPendingFollowInvite(
  next: Omit<PendingFollowInvite, "ts"> & { ts?: number },
): Promise<void> {
  memory = { ...next, ts: next.ts ?? Date.now() };
  emit();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  } catch (e) {
    console.warn("[pendingFollowInvite] persist failed", e);
  }
}

export async function clearPendingFollowInvite(): Promise<void> {
  memory = null;
  emit();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function hydratePendingFollowInvite(): Promise<PendingFollowInvite | null> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingFollowInvite;
    if (typeof parsed?.token !== "string" || parsed.token.length === 0) {
      return null;
    }
    // Drop invites older than 8 days (72h token + install slack).
    if (Date.now() - (parsed.ts ?? 0) > 8 * 24 * 60 * 60 * 1000) {
      await clearPendingFollowInvite();
      return null;
    }
    memory = parsed;
    emit();
    return memory;
  } catch {
    return null;
  }
}
