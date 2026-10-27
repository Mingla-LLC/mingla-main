import type { useRouter } from 'expo-router';
import type { QueryClient } from '@tanstack/react-query';
import { creatorProgramService, setupChecks, type CreatorSetupStatus } from '../../services/creatorProgramService';
import { nextSetupNav, runProgramNav } from '../programs/programNav';

export const SETUP_STEPS = ['profile', 'rates', 'showcase', 'socials', 'payout', 'agreement'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STATUS_KEY = ['creator', 'status'] as const;

/** "Your profile 1/6". */
export function stepTitle(step: SetupStep): string {
  const names: Record<SetupStep, string> = {
    profile: 'Your profile', rates: 'Your rates', showcase: 'Showcase video', socials: 'Verify a social account', payout: 'Payout account', agreement: 'Agreement',
  };
  return `${names[step]} ${SETUP_STEPS.indexOf(step) + 1}/${SETUP_STEPS.length}`;
}

export function firstOpenStep(status: CreatorSetupStatus | null | undefined, after?: SetupStep): SetupStep | null {
  const done = new Map(setupChecks(status).map((c) => [c.key, c.done]));
  const start = after ? SETUP_STEPS.indexOf(after) + 1 : 0;
  const ordered = [...SETUP_STEPS.slice(start), ...SETUP_STEPS.slice(0, start)];
  return ordered.find((step) => step !== after && !done.get(step)) ?? null;
}

/**
 * After a step saves: refresh the checklist and push the next open step, or
 * dismiss back to the checklist when everything is done. Never `replace`: that
 * dropped the checklist from history, so Back landed on the Profile tab (W5.3).
 */
export async function goToNextStep(router: ReturnType<typeof useRouter>, queryClient: QueryClient, current: SetupStep): Promise<void> {
  const status = await queryClient.fetchQuery({ queryKey: SETUP_STATUS_KEY, queryFn: () => creatorProgramService.status(), staleTime: 0 });
  void queryClient.invalidateQueries({ queryKey: ['creator'] });
  const next = firstOpenStep(status, current);
  runProgramNav(router, nextSetupNav(next));
}
