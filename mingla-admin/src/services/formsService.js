// #4452 §7.3–§7.5, §7.8 — Admin › Forms. Every call returns the server's data
// or throws its error (PostgREST code kept, so the builder can tell a PT409
// conflict from a failed check); no failure becomes an empty answer here.
// Every gate (forms_can_view / forms_can_edit / is_admin_user) is enforced
// again by the RPC or function.
import { supabase } from "../lib/supabase";
import { fetchConfig } from "./crmService";
import { revalidatePages } from "./websitePagesService";
import { PHOTO_LONG_EDGE, PHOTO_STORED_MAX, PHOTO_THUMB_EDGE, PHOTO_TOO_BIG_AFTER, fitEdge, functionErrorWords, photoPrecheck } from "../lib/formsModel";

export class FormsError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "FormsError";
    this.code = code;
    this.detail = detail;
  }
}

async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new FormsError(error.code || "server", error.message || "Something on the server failed.", error.details || null);
  return data;
}

async function fn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { payload = null; }
    // #4452 B19: a network or CORS failure has no payload; it reads as "unreachable", never the library's raw text.
    const code = payload?.error || (error?.name === "FunctionsFetchError" || error?.name === "FunctionsRelayError" ? "unreachable" : "function_error");
    throw new FormsError(code, functionErrorWords(error, payload));
  }
  return data;
}

// ── The list ────────────────────────────────────────────────────────────────
/** { rows, kpis, can_edit, is_admin } */
export const listForms = (status = null) => rpc("admin_forms_list", { p_status: status });
export const createForm = (name, audience, template = null) => rpc("admin_form_create", { p_name: name, p_audience: audience, p_template: template });
export const duplicateForm = (id) => rpc("admin_form_duplicate", { p_form_id: id });

// #4452 B27: the marketing site caches every form page with no expiry, so a change
// to what is live shows only after Admin asks the site to refresh. Every action that
// changes a live form goes through this one wrapper so the refresh cannot be forgotten.
// Resolves { result, refreshed }; a failed refresh never undoes the change, the caller
// shows siteRefreshWarning.
export async function refreshSiteAfter(action) {
  const result = await action();
  let refreshed = true;
  try { await revalidatePages(); } catch { refreshed = false; }
  return { result, refreshed };
}
/** Honest warning (with a retry button) for when the change saved but the site did not refresh. */
export function siteRefreshWarning(addToast, lead) {
  addToast({
    variant: "warning",
    title: `${lead} The site has not refreshed, so the public page may still show the old version.`,
    action: {
      label: "Refresh site",
      onClick: () => revalidatePages().then(
        () => addToast({ variant: "success", title: "The site refreshed." }),
        () => addToast({ variant: "error", title: "The site still did not refresh. Try again in a minute." }),
      ),
    },
  });
}
export const archiveForm = (id) => refreshSiteAfter(() => rpc("admin_form_archive", { p_form_id: id }));
export const unarchiveForm = (id) => refreshSiteAfter(() => rpc("admin_form_unarchive", { p_form_id: id }));

// ── One form ────────────────────────────────────────────────────────────────
/** { form, draft, draft_rev, live_version, versions, own_page } */
export const getForm = (id) => rpc("admin_form_get", { p_form_id: id });
/** Raises PT409 form_draft_conflict on a stale rev; returns { draft_rev }. */
export const saveFormDraft = (id, rev, draft) => rpc("admin_form_save_draft", { p_form_id: id, p_expected_rev: rev, p_draft: draft });
/** Stable destinations for the form builder; public routes remain aliases for these keys. */
export const getSchedulerProfiles = () => rpc("admin_scheduler_profiles");
/** Raises 22023 publish_check_failed (DETAIL = the failing list) or PT409; returns { version }. */
export const publishForm = (id, rev) => refreshSiteAfter(() => rpc("admin_form_publish", { p_form_id: id, p_expected_rev: rev }));

// ── Automations ─────────────────────────────────────────────────────────────
/** { draft, draft_rev, enabled, stops, live_version, kinds, steps, kpis, can_edit } */
export const getAutomation = (formId) => rpc("admin_automation_get", { p_form_id: formId });
export const saveAutomationDraft = (formId, rev, flow, stops) =>
  rpc("admin_automation_save_draft", { p_form_id: formId, p_expected_rev: rev, p_flow: flow, p_stops: stops });
export const publishAutomation = (formId, rev) => rpc("admin_automation_publish", { p_form_id: formId, p_expected_rev: rev });
export const setAutomationEnabled = (formId, enabled) => rpc("admin_automation_set_enabled", { p_form_id: formId, p_enabled: enabled });
/** §5.8: every email step of the draft flow to me (or one step). Sets tested_at. */
export const sendTestEmails = (formId, stepId = null) => fn("forms-admin", { action: "test_email", form_id: formId, ...(stepId ? { step_id: stepId } : {}) });
/** §5.8: a test run with 1-minute waits, to me only. */
export const testWholeFlow = (formId) => fn("forms-admin", { action: "test_flow", form_id: formId });

// ── Results (§7.5) ──────────────────────────────────────────────────────────
export const formResults = (formId, from, to) => rpc("admin_form_results", { p_form_id: formId, p_from: from, p_to: to });

// ── Where it shows: the live and draft placements of every page ─────────────
export const sitePagesState = () => rpc("admin_site_pages_state");

// ── CRM stages and team for a stage step (F-4) and the card owner ───────────
/** crm_config's pipeline stages ({id,label}) and team emails. */
export async function crmChoices(pipeline) {
  // Through crmService (the one caller of crm_* functions, #3802).
  const cfg = await fetchConfig();
  const def = cfg?.pipelines?.[pipeline];
  const stages = Array.isArray(def?.stages) ? def.stages : [];
  return {
    stages: stages.map((s) => (typeof s === "string" ? { id: s, label: s } : { id: s.id || s.key, label: s.label || s.name || s.id || s.key })),
    team: (cfg?.team || []).map((t) => ({ email: t.email, name: t.display_name || t.email })),
  };
}

// ── Google conversions (§7.8, admins only) ──────────────────────────────────
/** { connected, kinds: { <kind>: { ready } } } — never a resource name. */
export const googleConversionKinds = () => rpc("admin_google_conversion_kinds");
export const createGoogleConversion = (kind) => fn("admin-ad-google-provision-conversion", { lane: "consumer", kind });

// ── Photos (§1.6): resized in the browser, no Image Transformations ─────────
async function encode(bitmap, edge, quality) {
  const { width, height } = fitEdge(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new FormsError("image_encode_failed", "The photo could not be prepared.");
  return blob;
}

/** Up to 8 MB in; stored as a JPEG ≤ 5 MiB (long edge 2400 at 0.85, then 0.75), plus a 600 px _thumb. */
export async function prepareFormPhoto(file) {
  const problem = photoPrecheck(file);
  if (problem) throw new FormsError("photo_rejected", problem);
  const bitmap = await createImageBitmap(file);
  try {
    let main = await encode(bitmap, PHOTO_LONG_EDGE, 0.85);
    if (main.size > PHOTO_STORED_MAX) main = await encode(bitmap, PHOTO_LONG_EDGE, 0.75);
    if (main.size > PHOTO_STORED_MAX) throw new FormsError("photo_too_large", PHOTO_TOO_BIG_AFTER);
    const thumb = await encode(bitmap, PHOTO_THUMB_EDGE, 0.8);
    return { main, thumb };
  } finally {
    bitmap.close?.();
  }
}

function publicUrl(path) {
  return supabase.storage.from("site-media").getPublicUrl(path).data.publicUrl;
}

/** Upload a prepared photo under my own folder (the bucket policy), returning both URLs. */
export async function uploadFormPhoto(file) {
  const { main, thumb } = await prepareFormPhoto(file);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new FormsError("unauthorized", "Sign in again to upload.");
  const id = globalThis.crypto.randomUUID();
  const path = `${user.id}/forms/${id}.jpg`;
  const thumbPath = `${user.id}/forms/${id}_thumb.jpg`;
  const opts = { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" };
  const a = await supabase.storage.from("site-media").upload(path, main, opts);
  if (a.error) throw new FormsError("upload_failed", a.error.message || "The upload failed.");
  const b = await supabase.storage.from("site-media").upload(thumbPath, thumb, opts);
  if (b.error) {
    await supabase.storage.from("site-media").remove([path]);
    throw new FormsError("upload_failed", b.error.message || "The upload failed.");
  }
  return { photo: `upload:${id}`, photo_url: publicUrl(path), photo_thumb_url: publicUrl(thumbPath) };
}

/** The brand library (site-media/library/): every photo with its _thumb. */
export async function libraryPhotos() {
  const { data, error } = await supabase.storage.from("site-media").list("library", { limit: 100, sortBy: { column: "name", order: "asc" } });
  if (error) throw new FormsError("library_failed", error.message || "The photo library did not load.");
  return (data || [])
    .filter((o) => /\.(jpe?g|png|webp)$/i.test(o.name) && !/_thumb\.(jpe?g|png|webp)$/i.test(o.name))
    .map((o) => {
      const thumbName = o.name.replace(/\.(jpe?g|png|webp)$/i, "_thumb.jpg");
      const hasThumb = (data || []).some((x) => x.name === thumbName);
      return {
        photo: `library:${o.name}`,
        photo_url: publicUrl(`library/${o.name}`),
        photo_thumb_url: publicUrl(`library/${hasThumb ? thumbName : o.name}`),
        name: o.name.replace(/\.(jpe?g|png|webp)$/i, "").replace(/[-_]+/g, " "),
      };
    });
}

/** The words for a failure, by code (never "Something went wrong"). */
export function formsErrorWords(error) {
  const code = error?.code || "";
  if (code === "PT409") return "Someone else changed this form.";
  if (code === "42501") return "You don't have edit access. Ask an admin for the Website editor role.";
  if (code === "P0002") return "That form is gone. It may have been removed.";
  if (code === "22023" && /locked_field/.test(error?.message || "")) return "Name, email and phone are locked by the template.";
  if (code === "22023" && /publish_check_failed/.test(error?.message || "")) return "Some checks failed. Fix the items marked ! to publish.";
  if (code === "22023" && /form_archived/.test(error?.message || "")) return "This form is archived. Unarchive it to edit.";
  if (code === "22023" && /host_phone_required/.test(error?.message || "")) return "Host forms need one required phone-number question.";
  if (code === "22023" && /scheduler_not_found/.test(error?.message || "")) return "Choose a call calendar that is available.";
  if (code === "22023" && /bad_after_submit/.test(error?.message || "")) return "Check what should happen after someone sends the form.";
  if (/slug/.test(error?.message || "")) return "That link was used before. Pick another.";
  return error?.message || "That did not go through. Try again.";
}
