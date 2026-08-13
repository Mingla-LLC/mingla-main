export const CONTACT_IMPORT_ATTESTATION_VERSION =
  "contact-import-attestation-v1";
export const CONTACT_IMPORT_MAPPING_VERSION = "csv-contact-mapping-v1";
export const CONTACT_IMPORT_ATTESTATION_TEMPLATE =
  "I confirm the people on this list gave {brandName} permission to contact them by email and text, and that {brandName} collected this list itself — it wasn’t bought, rented or scraped. I understand Mingla records this confirmation with my name, today’s date and this exact wording, tied to this import.";

export const renderContactImportAttestation = (brandName: string): string =>
  CONTACT_IMPORT_ATTESTATION_TEMPLATE.replaceAll("{brandName}", brandName);
