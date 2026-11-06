/**
 * Issue #4261 Wave B1 — hold a group link (deep_link_value=group_invite) until
 * the person is signed in and onboarded, then join with join_group_by_link.
 * Same shape as pendingFriendInvite.ts: memory + AsyncStorage so the token
 * survives the store install and onboarding; 30-day max age. Cleared on logout.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "mingla_pending_group_invite_v1";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type PendingGroupInvite = {
  groupToken: string;
  shareToken?: string;
  ts: number;
};

let memory: PendingGroupInvite | null = null;

async function persist(): Promise<void> {
  try {
    if (memory) await AsyncStorage.setItem(KEY, JSON.stringify(memory));
    else await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn("[pendingGroupInvite] persist failed", e);
  }
}

export async function setPendingGroupInvite(groupToken: string, shareToken?: string): Promise<void> {
  memory = shareToken ? { groupToken, shareToken, ts: Date.now() } : { groupToken, ts: Date.now() };
  await persist();
}

export async function clearPendingGroupInvite(): Promise<void> {
  memory = null;
  await persist();
}

export async function hydratePendingGroupInvite(): Promise<PendingGroupInvite | null> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingGroupInvite;
    if (typeof parsed?.groupToken !== "string" || parsed.groupToken.length === 0) return null;
    if (Date.now() - (parsed.ts ?? 0) > MAX_AGE_MS) {
      await clearPendingGroupInvite();
      return null;
    }
    memory = parsed;
    return memory;
  } catch (e) {
    console.warn("[pendingGroupInvite] hydrate failed", e);
    return null;
  }
}
