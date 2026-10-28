import type { ArtifactV2 } from "../../../contracts/generated/artifactV2.ts";
import { CONTACT_MESSAGE_MAX, CONTACT_MESSAGE_MIN, CONTACT_NAME_MAX, EMAIL_MAX } from "../../../contracts/generated/forms.ts";
import { formAnchor, formErrorMessage, formSuccessMessage, type FormsContext } from "../../../lib/siteForms";
import { SiteForm, type SiteFormField } from "./SiteForm";

/*
 * #2829 W5 (amendment A4) — the contact form and newsletter box blocks.
 *
 * Fixed field sets (no arbitrary fields): the contact form always asks for a
 * name, an email and a message (Mingla needs all three to answer), and a
 * phone number only when the owner switched it on; the newsletter box asks for
 * an email. Sends go to the site's own /api/forms routes, which forward to
 * Mingla. When Mingla says this brand is not taking messages, the contact form
 * is not shown (the owner's fallback email is, when there is one).
 */
type Block = Readonly<Record<string, unknown>>;

export const PREVIEW_NOTE = "Forms don't send from a preview. Publish to start receiving messages.";
/** #2829 W10 — what a visitor on a private share link reads instead of a working form. */
export const SHARED_PREVIEW_NOTE = "Forms work once the site is live.";

/** The switched-off reason for a form in a preview (none on the live site). */
export function previewNoteFor(forms: { preview?: boolean; shared?: boolean }): string | undefined {
  if (!forms.preview) return undefined;
  return forms.shared ? SHARED_PREVIEW_NOTE : PREVIEW_NOTE;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function Heading({ block }: { block: Block }) {
  const heading = text(block.heading);
  return (
    <>
      {text(block.eyebrow) && text(block.eyebrow) !== heading ? <p className="eyebrow">{text(block.eyebrow)}</p> : null}
      {heading ? <h2>{heading}</h2> : null}
    </>
  );
}

export function noticeFor(forms: FormsContext, blockIndex: number, kind: "contact" | "newsletter", artifact: ArtifactV2, block: Block) {
  const notice = forms.notice;
  if (!notice || notice.blockIndex !== blockIndex || notice.kind !== kind) return null;
  return notice.ok
    ? { ok: true, message: formSuccessMessage(kind, artifact.brand.display_name, block.success_text) }
    : { ok: false, message: formErrorMessage(notice.error, { name: artifact.brand.display_name, fallbackEmail: text(block.fallback_email) || null }) };
}

export function hiddenFields(forms: FormsContext, pagePath: string, blockIndex: number) {
  return { page: pagePath, block: String(blockIndex), t0: String(forms.renderedAt), ts: forms.signature };
}

/** The contact form's fixed field set (#4111 needs a name, an email and a message). */
export function contactFields(block: Block, labels: { name?: string; email?: string } = {}): SiteFormField[] {
  return [
    { name: "name", label: labels.name ?? "Your name", type: "text", required: true, autoComplete: "name", maxLength: CONTACT_NAME_MAX, placeholder: text(block.name_placeholder) || undefined },
    { name: "email", label: labels.email ?? "Email", type: "email", required: true, autoComplete: "email", maxLength: EMAIL_MAX, placeholder: text(block.email_placeholder) || undefined },
    ...(block.show_phone === true
      ? [{ name: "phone", label: "Phone", type: "tel", required: false, autoComplete: "tel", placeholder: "+1 555 010 0100", maxLength: 20 } as SiteFormField]
      : []),
    {
      name: "message",
      label: text(block.message_label) || "Message",
      type: "textarea",
      required: true,
      placeholder: text(block.message_placeholder) || undefined,
      minLength: CONTACT_MESSAGE_MIN,
      maxLength: CONTACT_MESSAGE_MAX,
    },
  ];
}

export function ContactFormBlock({ block, artifact, forms, pagePath, blockIndex }: {
  block: Block;
  artifact: ArtifactV2;
  forms: FormsContext;
  pagePath: string;
  blockIndex: number;
}) {
  const fallback = text(block.fallback_email);
  if (forms.enquiries === "unavailable") {
    return fallback ? (
      <section className="site-form-block site-contact" data-enquiries="unavailable">
        <Heading block={block} />
        <p className="site-form-fallback">You can email us at <a href={`mailto:${fallback}`}>{fallback}</a>.</p>
      </section>
    ) : null;
  }
  const fields = contactFields(block);
  return (
    <section className="site-form-block site-contact" data-enquiries={forms.enquiries}>
      <Heading block={block} />
      {text(block.intro) ? <p className="site-intro">{text(block.intro)}</p> : null}
      <SiteForm
        kind="contact"
        anchor={formAnchor(blockIndex)}
        action="/api/forms/contact"
        hidden={hiddenFields(forms, pagePath, blockIndex)}
        fields={fields}
        submitLabel={text(block.submit_label) || "Send"}
        initialNotice={noticeFor(forms, blockIndex, "contact", artifact, block)}
        disabledReason={previewNoteFor(forms)}
      />
      {fallback ? <p className="site-form-fallback">Or email us at <a href={`mailto:${fallback}`}>{fallback}</a>.</p> : null}
    </section>
  );
}

export function NewsletterBlock({ block, artifact, forms, pagePath, blockIndex }: {
  block: Block;
  artifact: ArtifactV2;
  forms: FormsContext;
  pagePath: string;
  blockIndex: number;
}) {
  // The words shown here (heading, body, button label, small print) are the
  // consent text recorded with each signup — exactly as rendered.
  return (
    <section className="site-form-block site-newsletter">
      <Heading block={block} />
      {text(block.body) ? <p className="site-intro">{text(block.body)}</p> : null}
      <SiteForm
        kind="newsletter"
        anchor={formAnchor(blockIndex)}
        action="/api/forms/newsletter"
        hidden={hiddenFields(forms, pagePath, blockIndex)}
        fields={[{ name: "email", label: "Email", type: "email", required: true, autoComplete: "email", placeholder: text(block.placeholder) || undefined, maxLength: EMAIL_MAX }]}
        submitLabel={text(block.button_label) || "Subscribe"}
        initialNotice={noticeFor(forms, blockIndex, "newsletter", artifact, block)}
        disabledReason={previewNoteFor(forms)}
      />
      {text(block.small_print) ? <p className="site-small-print">{text(block.small_print)}</p> : null}
    </section>
  );
}
