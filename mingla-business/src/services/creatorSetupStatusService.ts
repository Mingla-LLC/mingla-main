import type { CreatorSetupStatus } from "./creatorProgramContract";
import { supabase } from "./supabase";

export async function fetchCreatorSetupStatus(): Promise<CreatorSetupStatus> {
  const { data, error } = await supabase.rpc("creator_setup_status");
  if (error) throw error;
  return data as CreatorSetupStatus;
}
