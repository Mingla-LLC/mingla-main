import { Section, sectionId, text, type VoyageBlockProps } from "../parts";

/*
 * #2829 W7 — contact_details `tiles`: an optional heading and sentence, then
 * the email and the location each in their own tile, on a tinted band.
 */
export function ContactDetailsTiles({ block, index }: VoyageBlockProps) {
  const id = sectionId(block, index);
  const heading = text(block.heading);
  const email = text(block.email);
  const location = text(block.location);
  if (!email && !location && !heading) return null;
  return (
    <Section tinted labelledBy={heading ? id : undefined}>
      <div className="v-contact">
        {heading ? <h2 id={id}>{heading}</h2> : null}
        {text(block.body) ? <p className="v-body-line">{text(block.body)}</p> : null}
        <dl className="v-contact__tiles">
          {email ? (
            <div className="card card--raised v-contact__tile">
              <dt className="micro-label v-label-accent">Email</dt>
              <dd className="v-contact__value">Email: <a href={`mailto:${email}`} className="link">{email}</a></dd>
            </div>
          ) : null}
          {location ? (
            <div className="card card--raised v-contact__tile">
              <dt className="micro-label v-label-accent">Location</dt>
              <dd className="v-contact__value">{location}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </Section>
  );
}
