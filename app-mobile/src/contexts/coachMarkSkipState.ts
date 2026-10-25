const skippedCoachStepsByUser = new Map<string, ReadonlySet<number>>();

export function readSkippedCoachSteps(userId: string | undefined): ReadonlySet<number> {
  return new Set(userId ? skippedCoachStepsByUser.get(userId) ?? [] : []);
}

export function rememberSkippedCoachStep(userId: string | undefined, stepId: number): ReadonlySet<number> {
  const next = new Set(readSkippedCoachSteps(userId));
  next.add(stepId);
  if (userId) skippedCoachStepsByUser.set(userId, next);
  return next;
}

export function nextUnskippedCoachStep(current: number, stepCount: number, skipped: ReadonlySet<number>): number {
  let next = current + 1;
  while (next <= stepCount && skipped.has(next)) next += 1;
  return next;
}

export function previousUnskippedCoachStep(current: number, skipped: ReadonlySet<number>): number {
  let previous = current - 1;
  while (previous > 1 && skipped.has(previous)) previous -= 1;
  return previous;
}

export function coachProgressFor(current: number, stepIds: readonly number[], skipped: ReadonlySet<number>): { current: number; total: number } {
  return {
    current: stepIds.filter((step) => step <= current && !skipped.has(step)).length,
    total: stepIds.filter((step) => !skipped.has(step)).length,
  };
}

export function shouldSkipDiscoverPillCoachStep(input: {
  active: boolean;
  loading: boolean;
  error: boolean;
  hasData: boolean;
  visibleKindCount: number;
}): boolean {
  return input.active && !input.loading && !input.error && input.hasData && input.visibleKindCount < 2;
}

export function resetSkippedCoachStepsForTests(): void {
  skippedCoachStepsByUser.clear();
}
