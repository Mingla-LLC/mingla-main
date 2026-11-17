// #4452 §5.8 forms-admin: "Send me this email" and "Test the whole flow".
//
// Signed-in staff only: the caller's JWT must pass forms_can_edit() (checked
// through the caller's own client). Test emails go only to the caller's own
// staff email, prefixed "[Test]". A test flow is an is_test submission whose
// run sends every email in order to the caller, with waits of 1 minute; it
// never routes, never fires a Lead and is hidden from Results and Leads.

import { type GateSend, renderFormEmail } from "../forms-automation-sender/sender.ts";
// #4452 B19: Admin calls this from the browser (supabase.functions.invoke), so
// the preflight must be answered and every answer, errors included, must carry
// CORS headers. The shared Admin-function headers: the JWT is the gate, not
// the origin (no cookies), the same as every other Admin function.
import { corsHeaders } from "../_shared/cors.ts";

export const SAMPLE_ANSWERS: Record<string, unknown> = {
  name: "Ada Okafor", city: { label: "Lagos" }, what_do_you_make: "Video",
  your_main_social: { platform: "instagram", url: "https://instagram.com/ada.films" },
};

export interface AdminDeps {
  canEdit: () => Promise<boolean>;
  callerEmail: () => Promise<string | null>;
  loadForm: (formId: string) => Promise<{ id: string; key: string; name: string; audience: "host" | "creator" | "local"; draft: Record<string, unknown>; flow: Record<string, unknown> | null; live_version_id: string | null; automation_live: number | null } | null>;
  sendEmail: (email: { from: string; to: string[]; replyTo: string; subject: string; html: string; text: string; headers: Record<string, string> }) => Promise<boolean>;
  markTested: (formId: string) => Promise<void>;
  startTestFlow: (formId: string, email: string) => Promise<string | null>;
  env: (n: string) => string | undefined;
  signUnsubscribe: (email: string, formKey: string) => Promise<string>;
  trackBase: string;
}

function emailSteps(steps: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (list: unknown, waited: boolean) => {
    let w = waited;
    for (const s of Array.isArray(list) ? list as Array<Record<string, unknown>> : []) {
      if (s.type === "wait") w = true;
      else if (s.type === "email" || s.type === "team") out.push({ ...s, _kind: s.type === "team" ? "team_alert" : w ? "follow_up" : "confirmation" });
      else if (s.type === "branch") { walk(s.yes, w); walk(s.no, w); }
    }
  };
  walk(steps, false);
  return out;
}

/** The same response with the Admin CORS headers added. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function handleAdmin(req: Request, deps: AdminDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  try {
    return withCors(await handleAdminPost(req, deps));
  } catch (err) {
    console.error("[forms-admin] server_error", err instanceof Error ? err.name : "unknown");
    return withCors(Response.json({ error: "server", message: "Something on the server failed. Try again." }, { status: 500 }));
  }
}

async function handleAdminPost(req: Request, deps: AdminDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method" }, { status: 405 });
  if (!(await deps.canEdit())) return Response.json({ error: "forbidden", message: "You don't have edit access" }, { status: 403 });
  const me = await deps.callerEmail();
  if (!me) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "validation" }, { status: 400 }); }
  const formId = typeof body.form_id === "string" ? body.form_id : "";
  const form = formId ? await deps.loadForm(formId) : null;
  if (!form) return Response.json({ error: "form_not_found" }, { status: 404 });

  if (body.action === "test_email") {
    let steps = emailSteps((form.flow as { steps?: unknown } | null)?.steps);
    if (typeof body.step_id === "string") steps = steps.filter((s) => s.id === body.step_id);
    if (steps.length === 0) return Response.json({ error: "no_email_steps" }, { status: 409 });
    let sent = 0;
    for (const [i, step] of steps.entries()) {
      const g: GateSend = {
        action: "send", send_id: crypto.randomUUID(), run_id: "test", attempts: 1,
        email_kind: step._kind as GateSend["email_kind"], step, to: me, is_test: true,
        person: { email: me, name: "Ada Okafor", answers: SAMPLE_ANSWERS, page: "/creators", spot: "after-steps",
          utm_source: "meta", utm_campaign: "creators-lagos-nov", label: form.audience, ads_allowed: true, click_source: "meta",
          time_zone: "Africa/Lagos" },
        form: { id: form.id, key: form.key, name: form.name, audience: form.audience,
          fields: ((form.draft.fields ?? []) as Array<Record<string, unknown>>) },
      };
      const email = await renderFormEmail(g, deps);
      email.subject = email.subject.replace(/^\[Test\] /, steps.length > 1 ? `[Test ${i + 1}/${steps.length}] ` : "[Test] ");
      email.to = [me];   // a test never reaches a team inbox or a person
      if (await deps.sendEmail(email)) sent += 1;
    }
    if (sent > 0) await deps.markTested(form.id);
    return Response.json({ sent, tested: sent > 0 });
  }

  if (body.action === "test_flow") {
    if (!form.live_version_id || !form.automation_live) {
      return Response.json({ error: "publish_first", message: "Publish the form and its emails first." }, { status: 409 });
    }
    const run = await deps.startTestFlow(form.id, me);
    return Response.json({ run_id: run, message: "Test run sent to you: every email in order, with sample answers." });
  }
  return Response.json({ error: "validation" }, { status: 400 });
}
