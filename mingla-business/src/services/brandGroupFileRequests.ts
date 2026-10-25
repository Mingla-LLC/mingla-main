import Constants from "expo-constants";

import { supabase } from "./supabase";

const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
const supabaseUrl = extra?.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export interface BrandGroupFileRequest {
  uri: string;
  headers: Record<string, string>;
}

export async function brandGroupFilePreviewRequest(fileId: string): Promise<BrandGroupFileRequest> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to view this file.");
  return {
    uri: `${supabaseUrl}/functions/v1/brand-group-files?file_id=${encodeURIComponent(fileId)}`,
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
  };
}

/** #3988 — authorized Drive-generated poster request. The Drive id never reaches the client. */
export async function brandGroupFileThumbnailRequest(fileId: string): Promise<BrandGroupFileRequest> {
  const request = await brandGroupFilePreviewRequest(fileId);
  return { ...request, uri: `${request.uri}&variant=thumb` };
}
