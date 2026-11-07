/**
 * campaignDeleteService — #4273 extra (b). Delete on a failed or cancelled
 * campaign card (it used to call deleteDraft, which only deletes drafts, and
 * always failed).
 *
 * The server keeps on record anything that reached someone
 * (issue_4273_campaign_delete_guard: a sent-family message, a sent push, or a
 * recipient count above 0), and a confirmed send is also pinned by its
 * execution. Either way the method is free to send again.
 *
 * Lives apart from marketingCampaignService so it loads only with the campaign
 * list (that service is in the boot chunk). Throws on error (Constitution #3).
 */
import { supabase } from "../supabase";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const KEPT_FOR_RECORDS_COPY =
  "Mingla keeps this send on record because it reached people. You can still send by this method again.";

export class CampaignKeptForRecordsError extends Error {
  constructor() {
    super(KEPT_FOR_RECORDS_COPY);
    this.name = "CampaignKeptForRecordsError";
  }
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  if (!UUID_RE.test(campaignId)) {
    throw new Error(`deleteCampaign.campaign_id: expected UUID, got ${JSON.stringify(campaignId)}`);
  }
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .delete()
    .eq("id", campaignId)
    .in("status", ["failed", "cancelled"])
    .select("id");
  if (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "";
    if (code === "23503" || message.includes("campaign_kept_for_records")) {
      throw new CampaignKeptForRecordsError();
    }
    throw error;
  }
  if (!data || data.length === 0) {
    throw new Error("This campaign can't be deleted. Only a failed or cancelled send can.");
  }
}
