/**
 * issue #3281 [TRANSITIONAL] — edge functions deploy on merge, while migrations
 * apply later through the operator lane. A database without the by-date helpers
 * ignores `byDate`, so these carts must wait. Exit: remove once
 * 20271224003281 is applied in production.
 */
export interface ByDateGuardClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: unknown }>;
}

export function cartHasByDateLines(
  lines: ReadonlyArray<{ byDate?: unknown }>,
): boolean {
  return lines.some((line) =>
    line.byDate !== undefined && line.byDate !== null
  );
}

/** Any probe error fails closed: a missed sale beats a wrong entitlement. */
export async function byDateDatabaseReady(
  client: ByDateGuardClient,
): Promise<boolean> {
  try {
    const { error } = await client.rpc("issue_3281_line_qty_sum", {
      p_line: { quantity: 1 },
    });
    return error === null || error === undefined;
  } catch {
    return false;
  }
}
