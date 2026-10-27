import { EMAIL_MAX } from "../../../contracts/generated/forms.ts";
import { formAnchor } from "../../../lib/siteForms";
import { hiddenFields, noticeFor, previewNoteFor } from "../../../components/v2/neutral/FormBlocks";
import { SiteForm } from "../../../components/v2/neutral/SiteForm";
import { Section, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — newsletter_signup `card`: a centred white card on a tinted band
 * (heading, sentence, a pill email box beside the button, small print). The
 * words shown are the consent text recorded with each signup, exactly as
 * rendered; Mingla emails to confirm first (A4).
 */
export function NewsletterCard({ block, index, ctx }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const forms = ctx.forms;
  if (!forms) return null;
  return (
    <Section tinted labelledBy={id}>
      <div className="card card--raised v-newsletter">
        <h2 id={id}>{text(block.heading)}</h2>
        {text(block.body) ? <p className="v-body-line">{text(block.body)}</p> : null}
        <SiteForm
          skin="voyage"
          kind="newsletter"
          anchor={formAnchor(index)}
          action="/api/forms/newsletter"
          hidden={hiddenFields(forms, ctx.page.path, index)}
          fields={[{ name: "email", label: "Email", type: "email", required: true, autoComplete: "email", placeholder: text(block.placeholder) || "Email", maxLength: EMAIL_MAX }]}
          submitLabel={text(block.button_label) || "Subscribe"}
          initialNotice={noticeFor(forms, index, "newsletter", ctx.artifact, block)}
          disabledReason={previewNoteFor(forms)}
        />
        {text(block.small_print) ? <p className="meta v-small-print">{text(block.small_print)}</p> : null}
      </div>
    </Section>
  );
}
