import { formAnchor } from "../../../lib/siteForms";
import { contactFields, hiddenFields, noticeFor, previewNoteFor } from "../../../components/v2/neutral/FormBlocks";
import { SiteForm } from "../../../components/v2/neutral/SiteForm";
import { text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — contact_form `panel`: a white panel on a tinted band with pill
 * fields in rows and the arrow-disc button. Sends reach Mingla (#4111); when
 * Mingla says this brand is not taking messages, the panel shows the owner's
 * fallback email instead (or nothing).
 */
export function ContactFormPanel({ block, index, ctx }: VoyageBlockProps) {
  const forms = ctx.forms;
  if (!forms) return null;
  const anchor = formAnchor(index);
  const heading = text(block.heading);
  const intro = text(block.intro);
  const fallback = text(block.fallback_email);
  const fallbackNote = fallback ? (
    <p className="form-fallback">If you need an answer quickly, email <a href={`mailto:${fallback}`} className="link v-semibold">{fallback}</a> directly.</p>
  ) : null;
  if (forms.enquiries === "unavailable") {
    if (!fallback) return null;
    return (
      <section className="band is-tinted" data-enquiries="unavailable">
        <div className="shell"><div className="form-panel card card--raised">{heading ? <h2>{heading}</h2> : null}{fallbackNote}</div></div>
      </section>
    );
  }
  return (
    <section className="band is-tinted" aria-labelledby={heading ? `${anchor}-h` : undefined} data-enquiries={forms.enquiries}>
      <div className="shell">
        <div className="form-panel card card--raised">
          {heading ? <h2 id={`${anchor}-h`}>{heading}</h2> : null}
          {intro ? <p className="lede v-form-intro">{intro}</p> : null}
          <div className={heading || intro ? "v-form-body" : undefined}>
            <SiteForm
              skin="voyage"
              kind="contact"
              anchor={anchor}
              action="/api/forms/contact"
              hidden={hiddenFields(forms, ctx.page.path, index)}
              fields={contactFields(block, { name: "Name" })}
              submitLabel={text(block.submit_label) || "Send"}
              initialNotice={noticeFor(forms, index, "contact", ctx.artifact, block)}
              disabledReason={previewNoteFor(forms)}
            />
          </div>
          {fallbackNote}
        </div>
      </div>
    </section>
  );
}
