/**
 * #4430 L-2 — pull-to-refresh on Mingla Local.
 *
 * `refetchQueries` with no `type` also refetches queries nobody is showing,
 * including ones restored from storage that have no queryFn. That raised
 * "Missing queryFn" on every pull. Refetch only what is on screen, and just
 * mark the rest stale.
 */
import type { QueryClient } from '@tanstack/react-query';

export const LOCAL_ROOT_KEY = ['local'] as const;

export async function refreshLocal(queryClient: Pick<QueryClient, 'invalidateQueries' | 'refetchQueries'>): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: LOCAL_ROOT_KEY, refetchType: 'none' });
  await queryClient.refetchQueries({ queryKey: LOCAL_ROOT_KEY, type: 'active' }, { cancelRefetch: true });
}

/** A place-names query only runs when there is a place to name. */
export function placeNamesQueryEnabled(ids: ReadonlyArray<string | null | undefined>): boolean {
  return ids.some((id) => Boolean(id));
}
