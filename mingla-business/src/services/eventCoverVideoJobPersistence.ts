export type PersistedCoverVideoJob = {
  userId: string;
  key: string;
  jobId: string | null;
  clientOperationId: string;
  sourceUri: string | null;
  sourceFingerprint: string | null;
  sourceBytes: number;
  sourceDurationMs: number;
  sourceFileName: string | null;
  sourceMimeType: string | null;
  sourceExtension: string;
  sourceSha256: string;
  trimStartMs: number;
  trimEndMs: number;
  sourceAcknowledged: boolean;
};

const PREFIX = "mingla:event-cover-video:v2:";
export const readPersistedCoverVideoJob = async (userId: string, key: string): Promise<PersistedCoverVideoJob | null> => {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(`${PREFIX}${userId}:${key}`);
  if (value === null) return null;
  try { return JSON.parse(value) as PersistedCoverVideoJob; } catch { return null; }
};
export const writePersistedCoverVideoJob = async (job: PersistedCoverVideoJob): Promise<void> => {
  if (typeof localStorage !== "undefined") localStorage.setItem(`${PREFIX}${job.userId}:${job.key}`, JSON.stringify({ ...job, sourceUri: null }));
};
export const removePersistedCoverVideoJob = async (
  userId: string,
  key: string,
  _options?: { preserveSource?: boolean },
): Promise<void> => {
  if (typeof localStorage !== "undefined") localStorage.removeItem(`${PREFIX}${userId}:${key}`);
};
export const clearPersistedCoverVideoJobsForUser = async (userId: string): Promise<void> => {
  if (typeof localStorage === "undefined") return;
  const prefix = `${PREFIX}${userId}:`;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index); if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
};

const clearAllPersistedCoverVideoJobs = async (): Promise<void> => {
  if (typeof localStorage === "undefined") return;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
  }
};

// Logout cleanup is process-owned, not hook-owned: it runs even when no picker
// is mounted and clears every user namespace left in this browser profile.
void import("./supabase").then(({ supabase }) => {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") void clearAllPersistedCoverVideoJobs();
  });
});
