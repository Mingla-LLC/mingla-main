/**
 * #3988 — who gets a Host-reply alert from notify-support.
 *
 * The roster is decided in the database by
 * issue_3988_support_alert_recipients(): enabled, available support_staff rows
 * whose person is still on the Mingla team (Owners/Admins on the rota
 * included). A staff row alone never makes someone a recipient.
 *
 * Pure module (no Deno.serve / env reads) so the Deno suite can import it.
 */

export interface AlertRecipientsClient {
  rpc(
    fn: "issue_3988_support_alert_recipients",
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export async function availableStaffIds(
  admin: AlertRecipientsClient,
): Promise<string[]> {
  const { data, error } = await admin.rpc("issue_3988_support_alert_recipients");
  if (error) {
    console.error("[notify-support] alert recipients unavailable", error);
    return [];
  }
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const row of data) {
    // A SETOF uuid result arrives as plain strings.
    if (typeof row === "string" && row) ids.push(row);
  }
  return ids;
}
