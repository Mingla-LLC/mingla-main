import AsyncStorage from "@react-native-async-storage/async-storage";
import { deletePreparedEventCoverVideoSource } from "./eventCoverVideoPreparedSource";

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
  const value = await AsyncStorage.getItem(`${PREFIX}${userId}:${key}`);
  if (value === null) return null;
  try { return JSON.parse(value) as PersistedCoverVideoJob; } catch { return null; }
};
export const writePersistedCoverVideoJob = async (job: PersistedCoverVideoJob): Promise<void> => {
  await AsyncStorage.setItem(`${PREFIX}${job.userId}:${job.key}`, JSON.stringify(job));
};
export const removePersistedCoverVideoJob = async (
  userId: string,
  key: string,
  options?: { preserveSource?: boolean },
): Promise<void> => {
  const storageKey=`${PREFIX}${userId}:${key}`;
  const value=await AsyncStorage.getItem(storageKey);
  if(!options?.preserveSource&&value!==null){try{const job=JSON.parse(value) as PersistedCoverVideoJob;if(job.sourceUri)await deletePreparedEventCoverVideoSource(job.sourceUri);}catch{/* malformed persistence has no trustworthy owned URI */}}
  await AsyncStorage.removeItem(storageKey);
};
export const clearPersistedCoverVideoJobsForUser = async (userId: string): Promise<void> => {
  const prefix = `${PREFIX}${userId}:`; const keys = await AsyncStorage.getAllKeys();
  const owned = keys.filter((key) => key.startsWith(prefix));
  for(const key of owned){const value=await AsyncStorage.getItem(key);if(value!==null){try{const job=JSON.parse(value) as PersistedCoverVideoJob;if(job.sourceUri)await deletePreparedEventCoverVideoSource(job.sourceUri);}catch{/* malformed persistence has no trustworthy owned URI */}}}
  if (owned.length > 0) await AsyncStorage.multiRemove(owned);
};

const clearAllPersistedCoverVideoJobs = async ():Promise<void> => {
  const keys=(await AsyncStorage.getAllKeys()).filter((key)=>key.startsWith(PREFIX));
  for(const key of keys){const value=await AsyncStorage.getItem(key);if(value!==null){try{const job=JSON.parse(value) as PersistedCoverVideoJob;if(job.sourceUri)await deletePreparedEventCoverVideoSource(job.sourceUri);}catch{/* malformed persistence has no trustworthy owned URI */}}}
  if(keys.length>0)await AsyncStorage.multiRemove(keys);
};

// Process-owned logout cleanup remains active even when the upload hook is not mounted.
void import("./supabase").then(({supabase})=>{
  supabase.auth.onAuthStateChange((event)=>{if(event==="SIGNED_OUT")void clearAllPersistedCoverVideoJobs();});
});
