export const CONTACT_IMPORT_ATTESTATION_VERSION =
  "contact-import-attestation-v1";
export const CONTACT_IMPORT_MAPPING_VERSION = "csv-contact-mapping-v1";
export const CONTACT_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const CONTACT_IMPORT_MAX_ROWS = 10_000;

export const CONTACT_IMPORT_ATTESTATION_TEMPLATE =
  "I confirm the people on this list gave {brandName} permission to contact them by email and text, and that {brandName} collected this list itself — it wasn’t bought, rented or scraped. I understand Mingla records this confirmation with my name, today’s date and this exact wording, tied to this import.";

export type ContactImportTarget =
  | "full_name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "ignore";

export const CONTACT_IMPORT_ALIASES: Readonly<
  Record<Exclude<ContactImportTarget, "ignore">, readonly string[]>
> = {
  full_name: ["attendee name", "name", "full name", "contact name"],
  first_name: ["first name", "firstname", "first_name", "fname"],
  last_name: ["last name", "lastname", "last_name", "lname"],
  email: [
    "email",
    "email address",
    "email_address",
    "e-mail",
    "e-mail address",
  ],
  phone: [
    "cell phone",
    "phone",
    "phone number",
    "mobile",
    "mobile phone",
    "sms phone",
  ],
};

export function renderContactImportAttestation(brandName: string): string {
  return CONTACT_IMPORT_ATTESTATION_TEMPLATE.replaceAll(
    "{brandName}",
    brandName,
  );
}

export function normalizeContactImportHeader(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function suggestContactImportMapping(
  headers: readonly string[],
): Record<string, ContactImportTarget> {
  const candidates = headers.map((header) => {
    const normalized = normalizeContactImportHeader(header);
    const target = (Object.entries(CONTACT_IMPORT_ALIASES).find(([, aliases]) =>
      aliases.some((alias) =>
        normalizeContactImportHeader(alias) === normalized
      )
    )?.[0] ?? "ignore") as ContactImportTarget;
    return { header, target };
  });
  const counts = new Map<ContactImportTarget, number>();
  candidates.forEach(({ target }) =>
    counts.set(target, (counts.get(target) ?? 0) + 1)
  );
  return Object.fromEntries(candidates.map(({ header, target }) => [
    header,
    target !== "ignore" && (counts.get(target) ?? 0) > 1 ? "ignore" : target,
  ]));
}
