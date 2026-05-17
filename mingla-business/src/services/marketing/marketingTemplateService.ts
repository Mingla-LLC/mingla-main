/**
 * marketingTemplateService — template CRUD for the composer + Templates tab.
 *
 * Phase A: shipped read-only `listStarterTemplates` + `getTemplate`.
 *
 * Phase B (ORCH-0863): adds user-template CRUD + duplicate. Starter-pack
 * rows are RLS-protected at the DB layer (UPDATE/DELETE policies require
 * `is_starter_pack = false`), and a service-layer defense-in-depth guard
 * (assertNotStarterPack) fires BEFORE any UPDATE/DELETE call so the UI
 * cannot accidentally trigger a 403 round-trip — even if RLS were
 * misconfigured, the service refuses. T-08 adversarial test verifies.
 *
 * Token grammar preservation (CRITICAL): bodies contain two grammars —
 * single-brace {first_name} (substituted server-side by marketing-send)
 * and double-brace {{event:id}} (event-card embed token). Service methods
 * pass bodies through verbatim — no regex transform, no escape, no
 * normalization. T-04 happy-path test guards this.
 */

import { supabase } from "../supabase";
import type { MarketingTemplateRow } from "../../types/marketing";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label}: expected UUID, got ${JSON.stringify(value)}`);
  }
}

const TEMPLATE_COLS =
  "id, account_id, brand_id, name, channel, subject_template, body_template, is_starter_pack, created_at, updated_at";

export async function listStarterTemplates(): Promise<MarketingTemplateRow[]> {
  const { data, error } = await supabase
    .from("marketing_templates")
    .select(TEMPLATE_COLS)
    .eq("is_starter_pack", true)
    .eq("channel", "email")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as MarketingTemplateRow[]);
}

export async function getTemplate(
  templateId: string,
): Promise<MarketingTemplateRow | null> {
  assertUuid(templateId, "getTemplate.template_id");
  const { data, error } = await supabase
    .from("marketing_templates")
    .select(TEMPLATE_COLS)
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as MarketingTemplateRow | null;
}

// ---------------------------------------------------------------------------
// Phase B — user template CRUD (ORCH-0863)
// ---------------------------------------------------------------------------

/**
 * Defense-in-depth guard (T-08 adversarial test verifies):
 * Throws if the target template row is starter-pack. RLS already blocks
 * such writes at the DB layer (UPDATE/DELETE policies), but the service
 * layer ALSO refuses so that:
 *   (a) buggy UI cannot accidentally fire a 403 round-trip; and
 *   (b) even if RLS were misconfigured during a future migration, the
 *       service layer is a second line of defense.
 */
async function assertNotStarterPack(
  templateId: string,
  label: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("marketing_templates")
    .select("is_starter_pack")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error(`${label}: template not found`);
  }
  if ((data as { is_starter_pack: boolean }).is_starter_pack === true) {
    throw new Error("Cannot modify starter-pack template");
  }
}

export interface ListUserTemplatesInput {
  account_id: string;
}

export async function listUserTemplates(
  input: ListUserTemplatesInput,
): Promise<MarketingTemplateRow[]> {
  assertUuid(input.account_id, "listUserTemplates.account_id");
  const { data, error } = await supabase
    .from("marketing_templates")
    .select(TEMPLATE_COLS)
    .eq("is_starter_pack", false)
    .eq("account_id", input.account_id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as MarketingTemplateRow[]);
}

export interface CreateUserTemplateInput {
  account_id: string;
  brand_id: string | null;
  name: string;
  subject_template: string | null;
  body_template: string;
}

export async function createUserTemplate(
  input: CreateUserTemplateInput,
): Promise<MarketingTemplateRow> {
  assertUuid(input.account_id, "createUserTemplate.account_id");
  if (input.brand_id !== null) {
    assertUuid(input.brand_id, "createUserTemplate.brand_id");
  }
  if (input.name.trim().length === 0) {
    throw new Error("createUserTemplate: name is required");
  }
  if (input.body_template.length === 0) {
    throw new Error("createUserTemplate: body_template is required");
  }
  // Phase B is email-only; channel locked at create time.
  const { data, error } = await supabase
    .from("marketing_templates")
    .insert({
      account_id: input.account_id,
      brand_id: input.brand_id,
      name: input.name,
      channel: "email",
      subject_template: input.subject_template,
      body_template: input.body_template, // verbatim — no transform
      is_starter_pack: false,
    })
    .select(TEMPLATE_COLS)
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("createUserTemplate: insert returned no row (RLS?)");
  }
  return data as unknown as MarketingTemplateRow;
}

export interface UpdateUserTemplateInput {
  template_id: string;
  name: string;
  subject_template: string | null;
  body_template: string;
  brand_id?: string | null;
}

export async function updateUserTemplate(
  input: UpdateUserTemplateInput,
): Promise<MarketingTemplateRow> {
  assertUuid(input.template_id, "updateUserTemplate.template_id");
  if (input.brand_id !== undefined && input.brand_id !== null) {
    assertUuid(input.brand_id, "updateUserTemplate.brand_id");
  }
  if (input.name.trim().length === 0) {
    throw new Error("updateUserTemplate: name is required");
  }
  if (input.body_template.length === 0) {
    throw new Error("updateUserTemplate: body_template is required");
  }

  // Defense-in-depth: throw BEFORE the UPDATE round-trip if target is starter-pack.
  await assertNotStarterPack(input.template_id, "updateUserTemplate");

  const patch: Record<string, unknown> = {
    name: input.name,
    subject_template: input.subject_template,
    body_template: input.body_template, // verbatim — no transform
    updated_at: new Date().toISOString(),
  };
  if (input.brand_id !== undefined) {
    patch.brand_id = input.brand_id;
  }
  const { data, error } = await supabase
    .from("marketing_templates")
    .update(patch)
    .eq("id", input.template_id)
    .select(TEMPLATE_COLS)
    .maybeSingle();
  if (error) throw error;
  if (data === null) {
    throw new Error("updateUserTemplate: no row updated (RLS or not found)");
  }
  return data as unknown as MarketingTemplateRow;
}

export interface DuplicateTemplateInput {
  source_template_id: string;
  account_id: string;
  brand_id: string | null;
}

export async function duplicateTemplate(
  input: DuplicateTemplateInput,
): Promise<MarketingTemplateRow> {
  assertUuid(input.source_template_id, "duplicateTemplate.source_template_id");
  assertUuid(input.account_id, "duplicateTemplate.account_id");
  if (input.brand_id !== null) {
    assertUuid(input.brand_id, "duplicateTemplate.brand_id");
  }
  const source = await getTemplate(input.source_template_id);
  if (source === null) {
    throw new Error("duplicateTemplate: source template not found");
  }
  // Fields copied verbatim (preserves both {first_name} and {{event:id}}
  // token grammars exactly — no regex, no escape, no normalization).
  return createUserTemplate({
    account_id: input.account_id,
    brand_id: input.brand_id,
    name: `${source.name} (copy)`,
    subject_template: source.subject_template,
    body_template: source.body_template,
  });
}

export interface DeleteUserTemplateInput {
  template_id: string;
}

export async function deleteUserTemplate(
  input: DeleteUserTemplateInput,
): Promise<void> {
  assertUuid(input.template_id, "deleteUserTemplate.template_id");

  // Defense-in-depth: throw BEFORE the DELETE round-trip if target is starter-pack.
  await assertNotStarterPack(input.template_id, "deleteUserTemplate");

  const { data, error } = await supabase
    .from("marketing_templates")
    .delete()
    .eq("id", input.template_id)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("deleteUserTemplate: no row deleted (RLS or not found)");
  }
}
