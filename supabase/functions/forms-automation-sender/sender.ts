// #4452 §5.5–5.6 forms-automation-sender: claim due sends, apply the stop
// rules (forms_send_gate, SQL), render in the Mingla frame, send through
// Resend with an Idempotency-Key, and record the result.
//
// - Follow-ups carry List-Unsubscribe (https only) + List-Unsubscribe-Post and a
//   visible unsubscribe line; confirmations and team alerts do not.
// - The gate is asked twice: once at claim, and once right before the POST, so
//   an unsubscribe that lands while we render is still honoured.
// - Merge tokens are single-brace ({first_name}, {answers.city}); every value is
//   HTML-escaped and replaced in one pass, so a value containing "{answers.x}"
//   is never expanded again.
// - Team alerts go to TEAM_ALERT_TO with Reply-To the person, never to the person.
// - Retries: 429 / 5xx / network → back off (SQL: 15 min, 1 h, 6 h); another
//   4xx fails at once. Logs carry ids only.

import { escapeHtml } from "../_shared/email/escape.ts";
import { renderGenericBody } from "../_shared/email/genericBody.ts";
import {
  LOGO_PILL_URL,
  renderFacts,
  renderShell,
} from "../_shared/email/shell.ts";
import type { ActionBarInput } from "../_shared/email/actionBar.ts";
import type { EmailContentBlock } from "../_shared/email/types.ts";
import {
  type FormFrom,
  formSender,
  type FormTeamTo,
  teamAlertFrom,
  teamAlertTo,
} from "../_shared/formsSenders.ts";
import { clickUrl, openPixelUrl } from "../forms-track/sign.ts";

export interface GateSend {
  action: "send";
  send_id: string;
  run_id: string;
  attempts: number;
  email_kind: "confirmation" | "follow_up" | "team_alert";
  step: Record<string, unknown>;
  to: string;
  is_test: boolean;
  person: {
    email: string;
    name: string | null;
    answers: Record<string, unknown>;
    page: string;
    spot: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
    label: "host" | "creator" | "local";
    ads_allowed: boolean;
    click_source: string | null;
    time_zone: string;
  };
  form: {
    id: string;
    key: string;
    name: string;
    audience: "host" | "creator" | "local";
    fields: Array<Record<string, unknown>>;
    icp?: string | null;
  };
}

export interface SenderDb {
  claim(limit: number): Promise<Array<{ id: string; run_id: string }>>;
  gate(
    sendId: string,
  ): Promise<GateSend | { action: "skip" | "cancel"; reason: string }>;
  finish(
    sendId: string,
    status: "sent" | "failed" | "retry",
    error: string | null,
    providerId: string | null,
  ): Promise<void>;
}

export interface SenderDeps {
  db: SenderDb;
  env: (n: string) => string | undefined;
  fetchImpl?: typeof fetch;
  signUnsubscribe: (email: string, formKey: string) => Promise<string>;
  trackBase: string;
  log?: (l: string) => void;
}

const SITE = "https://usemingla.com";

/** {token} → escaped value, one pass (no re-expansion). */
export function mergeTokens(
  text: string,
  values: Record<string, string>,
  escape: boolean,
): string {
  return text.replace(
    /\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\}/g,
    (_m, token: string) => {
      const v = values[token] ?? "";
      return escape ? escapeHtml(v) : v;
    },
  );
}

function answerText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(answerText).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.label === "string") return o.label;
    if (typeof o.url === "string") return o.url;
    if (typeof o.from === "string") {
      return o.to ? `${o.from} to ${o.to}` : String(o.from);
    }
  }
  return "";
}

export function tokenValues(g: GateSend): Record<string, string> {
  const name = g.person.name ?? "";
  const values: Record<string, string> = {
    first_name: name.split(" ")[0] || "there",
    name,
    page: g.person.page,
    spot: g.person.spot ?? "",
    utm_source: g.person.utm_source ?? "",
    utm_campaign: g.person.utm_campaign ?? "",
    form_name: g.form.name,
  };
  for (const [k, v] of Object.entries(g.person.answers ?? {})) {
    values[`answers.${k}`] = answerText(v);
  }
  return values;
}

function answersFacts(g: GateSend): Array<[string, string]> {
  return (g.form.fields ?? [])
    .filter((f) => f.type !== "consent" && f.type !== "email")
    .map((f) =>
      [
        String(f.label ?? f.key),
        answerText(g.person.answers?.[String(f.key)]),
      ] as [string, string]
    )
    .filter(([, v]) => v !== "");
}

function personalize(
  doc: unknown,
  values: Record<string, string>,
): EmailContentBlock[] {
  if (!Array.isArray(doc)) return [];
  return doc.map((block) => {
    const b = { ...(block as Record<string, unknown>) };
    if (typeof b.html === "string") b.html = mergeTokens(b.html, values, true);
    // A plain paragraph block (Admin drafts) becomes rich text.
    if (b.type === "paragraph" && typeof b.text === "string") {
      return {
        type: "rich_text",
        html: `<p>${
          mergeTokens(escapeHtml(b.text), values, true).replace(/\n/g, "<br />")
        }</p>`,
      } as EmailContentBlock;
    }
    return b as unknown as EmailContentBlock;
  });
}

function barFor(g: GateSend): ActionBarInput | null {
  const setting = String(g.step.action_bar ?? "auto");
  if (setting === "off") return null;
  const kind =
    (setting === "auto" ? g.form.audience : setting) as ActionBarInput["kind"];
  return { kind, icp: (g.person.answers?.icp as string) ?? g.form.icp ?? null };
}

export interface RenderedEmail {
  from: string;
  to: string[];
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export async function renderFormEmail(
  g: GateSend,
  deps: Pick<SenderDeps, "signUnsubscribe" | "trackBase" | "env">,
): Promise<RenderedEmail> {
  const values = tokenValues(g);
  const secret = deps.env("UNSUBSCRIBE_TOKEN_SECRET") ?? "";
  const testPrefix = g.is_test ? "[Test] " : "";
  if (g.email_kind === "team_alert") {
    const label = g.person.label;
    const source = [
      g.person.page,
      g.person.spot,
      g.person.utm_source &&
      `${g.person.utm_source} / ${g.person.utm_campaign ?? ""}`,
    ]
      .filter(Boolean).join(" · ");
    const ad = !g.person.ads_allowed
      ? "Ads off (privacy strip)"
      : g.person.click_source
      ? `${g.person.click_source} click kept`
      : "none";
    const facts: Array<[string, string]> = [
      ["Name", g.person.name ?? ""],
      ["Email", g.person.email],
      ["Label", `${label} lead`],
      ["From", source],
      ["Ad click", ad],
      ...(g.step.include_answers === false ? [] : answersFacts(g)),
    ];
    const bodyHtml =
      `<h1 style="margin:0 0 14px 0;font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:30px;line-height:1.05;color:#111110;">New ${
        escapeHtml(label)
      } lead: ${escapeHtml(g.person.name ?? g.person.email)}</h1>
<p style="margin:0 0 8px 0;">They sent "${
        escapeHtml(g.form.name)
      }". Reply to this email to answer them directly.</p>${
        renderFacts(facts)
      }`;
    return {
      from: teamAlertFrom(),
      to: g.is_test
        ? [g.to]
        : teamAlertTo(String(g.step.to ?? "owner") as FormTeamTo),
      replyTo: g.person.email,
      subject: `${testPrefix}New ${label} lead: ${
        g.person.name ?? g.person.email
      } (${g.form.name})`,
      html: renderShell({
        preheader: `${g.person.name ?? ""} sent ${g.form.name}`,
        bodyHtml,
        supportEmail: "support@usemingla.com",
        logoUrl: LOGO_PILL_URL,
        footerAddress: "Mingla, Raleigh NC",
        label: "Team alert",
      }),
      text: facts.map(([k, v]) => `${k}: ${v}`).join("\n"),
      headers: { "Idempotency-Key": `forms-send-${g.send_id}` },
    };
  }
  const subject = testPrefix +
    mergeTokens(String(g.step.subject ?? ""), values, false);
  const generic = renderGenericBody(
    {
      variant: "admin_compose",
      title: subject.replace(testPrefix, ""),
      paragraphs: [],
      document: personalize(g.step.doc, values),
    } as never,
  );
  let body = generic.html;
  if (g.step.show_answers === true) body += renderFacts(answersFacts(g));
  const button = g.step.button as {
    text?: string;
    to?: { kind?: string; href?: string };
  } | undefined;
  if (button?.text) {
    const href = formButtonHref(button.to?.kind, button.to?.href);
    body += `<p style="margin:20px 0 0 0;"><a href="${
      escapeHtml(href)
    }" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#111110;color:#FFFFFF;border:3px solid #EB7825;box-shadow:0 0 0 3px #EB7825;font-weight:600;text-decoration:none;">${
      escapeHtml(button.text)
    }</a></p>`;
  }
  const followUp = g.email_kind === "follow_up";
  const headers: Record<string, string> = {
    "Idempotency-Key": `forms-send-${g.send_id}`,
  };
  let unsubscribeUrl: string | null = null;
  if (followUp) {
    const token = await deps.signUnsubscribe(g.person.email, g.form.key);
    unsubscribeUrl = `${SITE}/unsubscribe?token=${encodeURIComponent(token)}`;
    headers["List-Unsubscribe"] = `<${SITE}/api/unsubscribe/one-click?token=${
      encodeURIComponent(token)
    }>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  let html = renderShell({
    preheader: generic.preheader,
    bodyHtml: body,
    supportEmail: "support@usemingla.com",
    logoUrl: LOGO_PILL_URL,
    footerAddress: "Mingla, Raleigh NC",
    actionBar: barFor(g),
    unsubscribeUrl,
  });
  if (secret) {
    // Track every link except the unsubscribe ones and mailto, then add the open pixel.
    const hrefs = [
      ...new Set(
        [...html.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"/g)].map((m) =>
          m[1]
        ),
      ),
    ];
    for (const h of hrefs) {
      if (h.includes("/unsubscribe")) continue;
      const original = h.replace(/&amp;/g, "&");
      const tracked = await clickUrl(
        deps.trackBase,
        secret,
        g.send_id,
        original,
      );
      html = html.split(`href="${h}"`).join(`href="${escapeHtml(tracked)}"`);
    }
    const pixel = await openPixelUrl(deps.trackBase, secret, g.send_id);
    html = html.replace(
      "</body>",
      `<img src="${
        escapeHtml(pixel)
      }" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" /></body>`,
    );
  }
  const sender = formSender(String(g.step.from ?? "hosts") as FormFrom);
  return {
    from: sender.from,
    to: [g.to],
    replyTo: sender.replyTo,
    subject,
    html,
    text: generic.text,
    headers,
  };
}

/** #4640: new email buttons use the scheduler registry key; old saved flows keep their aliases. */
export function formButtonHref(kind?: string, href?: string): string {
  if (kind === "url" && href) return href;
  if (kind?.startsWith("scheduler:")) {
    const key = kind.slice("scheduler:".length);
    if (/^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/.test(key)) {
      return `${SITE}/schedule?profile=${encodeURIComponent(key)}`;
    }
  }
  if (kind === "schedule_creators") return `${SITE}/schedule/creators`;
  if (kind === "schedule_locals") return `${SITE}/schedule/locals`;
  if (kind === "app") return `${SITE}/download`;
  return `${SITE}/schedule`;
}

export async function runSender(
  req: Request,
  deps: SenderDeps,
): Promise<Response> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const service = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!service || bearer !== service) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }
  if (deps.env("FORMS_SENDER_PAUSED") === "1") {
    return Response.json({ claimed: 0, paused: true });
  }
  const resendKey = deps.env("RESEND_API_KEY") ?? "";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const claimed = await deps.db.claim(50);
  const out = {
    claimed: claimed.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    retry: 0,
  };
  for (const c of claimed) {
    try {
      const g = await deps.db.gate(c.id);
      if (g.action !== "send") {
        out.skipped += 1;
        continue;
      }
      const email = await renderFormEmail(g, deps);
      // Re-check right before the POST (an unsubscribe while we rendered).
      const again = await deps.db.gate(c.id);
      if (again.action !== "send") {
        out.skipped += 1;
        continue;
      }
      if (!resendKey) {
        await deps.db.finish(c.id, "retry", "resend_key_missing", null);
        out.retry += 1;
        continue;
      }
      let res: Response;
      try {
        res = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
            ...email.headers,
          },
          body: JSON.stringify({
            from: email.from,
            to: email.to,
            reply_to: email.replyTo,
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: Object.fromEntries(
              Object.entries(email.headers).filter(([k]) =>
                k.startsWith("List-")
              ),
            ),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        await deps.db.finish(c.id, "retry", "network", null);
        out.retry += 1;
        log(`[forms-automation-sender] retry send=${c.id} reason=network`);
        continue;
      }
      if (res.ok) {
        const id =
          ((await res.json().catch(() => ({}))) as { id?: string }).id ?? null;
        await deps.db.finish(c.id, "sent", null, id);
        out.sent += 1;
      } else if (res.status === 429 || res.status >= 500) {
        await deps.db.finish(c.id, "retry", `resend_${res.status}`, null);
        out.retry += 1;
      } else {
        await deps.db.finish(c.id, "failed", `resend_${res.status}`, null);
        out.failed += 1;
      }
      log(
        `[forms-automation-sender] ${
          res.ok ? "sent" : "error"
        } send=${c.id} status=${res.status}`,
      );
    } catch (err) {
      await deps.db.finish(c.id, "retry", "render_error", null).catch(() => {});
      out.retry += 1;
      log(
        `[forms-automation-sender] render_error send=${c.id} ${
          err instanceof Error ? err.name : "error"
        }`,
      );
    }
  }
  return Response.json(out);
}
