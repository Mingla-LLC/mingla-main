// #4541 R4.3: a Blast's "+ Form" on the server. Confirm (and schedule) checks
// the embedded form; a scheduled Blast whose form closed first is failed
// (form_closed) and the host told; each recipient gets their own link, minted
// after Blast's audience, consent and unsubscribe rules have picked them (so an
// unsubscribed contact never gets one). Blast forms never use the form-request
// queue (brand_form_request_sends).

import { blastFormUrl, embeddedFormIdOf } from "../_shared/blastFormLinks.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

/** The inert email placeholder each recipient's own form link replaces. */
export const BLAST_FORM_URL_MARKER = "__MINGLA_BLAST_FORM_URL_V1__";

export interface EmbeddedForm {
  formId: string;
  formName: string;
}

/**
 * The confirm/schedule refusal for a campaign whose embedded form is not live
 * (409 embedded_form_not_live) or not this brand's (403 embedded_form_other_brand),
 * or null to continue. A campaign without a form is never read twice.
 */
export async function blastFormConfirmRefusal(
  client: Client,
  campaignId: string,
): Promise<{ status: number; code: string } | null> {
  const { data, error } = await client.rpc("brand_form_blast_check", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(`blast_form_check:${error.message ?? "failed"}`);
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok === true || d.code === "campaign_not_found") return null;
  return d.code === "embedded_form_other_brand"
    ? { status: 403, code: "embedded_form_other_brand" }
    : { status: 409, code: "embedded_form_not_live" };
}

/** At claim: true when the campaign's form closed first (the campaign is now failed, form_closed). */
export async function holdIfBlastFormClosed(client: Client, campaignId: string): Promise<boolean> {
  const { data, error } = await client.rpc("brand_form_blast_hold_if_closed", {
    p_campaign_id: campaignId,
  });
  if (error) throw new Error(`blast_form_hold:${error.message ?? "failed"}`);
  return data === true;
}

/** The campaign's live embedded form (its name for the email button), or null. */
export async function loadEmbeddedForm(
  client: Client,
  campaign: { id: string; channel_payload: unknown },
): Promise<EmbeddedForm | null> {
  if (embeddedFormIdOf(campaign.channel_payload) === null) return null;
  const { data, error } = await client.rpc("brand_form_blast_check", {
    p_campaign_id: campaign.id,
  });
  if (error) throw new Error(`blast_form_check:${error.message ?? "failed"}`);
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true || typeof d.formId !== "string") throw new Error("blast_form_not_live");
  return { formId: d.formId, formName: typeof d.formName === "string" ? d.formName : "the form" };
}

/** One recipient's own form link (a new one switches off their earlier ones). */
export async function mintBlastFormUrl(
  client: Client,
  input: { formId: string; campaignId: string; contactKey: string; label: string | null },
): Promise<string> {
  const { data, error } = await client.rpc("brand_form_link_issue_blast", {
    p_form_id: input.formId,
    p_campaign_id: input.campaignId,
    p_contact_key: input.contactKey,
    p_recipient_label: input.label,
  });
  if (error) throw new Error(`blast_form_link:${error.message ?? "failed"}`);
  const token = (data as Record<string, unknown> | null)?.token;
  if (typeof token !== "string") throw new Error("blast_form_link:shape");
  return blastFormUrl(input.formId, input.campaignId, token);
}

/** May this account get the form by push now (BRAND_FORMS_PUSH on and an app that opens it)? */
export async function blastFormPushEligible(client: Client, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc("brand_form_push_eligible", { p_user_id: userId });
  if (error) {
    console.error("[marketing-send] blast form push eligibility unreadable: no form push");
    return false;
  }
  return data === true;
}
