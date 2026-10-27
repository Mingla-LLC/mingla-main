import { headers } from "next/headers";
import { handleFormSubmission } from "../../../../lib/formSubmission";
import { loadPublication, requestHost } from "../../../../lib/publication";

export const dynamic = "force-dynamic";

/**
 * #2829 W5 (amendment A4) — a site's contact form posts here (a plain HTML form or
 * the page's enhanced submit). The publication is the one Core resolved for
 * this request's host; see lib/formSubmission.ts.
 */
export async function POST(request: Request): Promise<Response> {
  return handleFormSubmission("contact", request, async () => loadPublication(requestHost(await headers())));
}
