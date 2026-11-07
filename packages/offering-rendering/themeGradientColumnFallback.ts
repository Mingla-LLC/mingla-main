// [TRANSITIONAL] issue #1023 wave 2 — the gradient columns
// (`brands.theme_gradient`, `events.theme_gradient_override`, and the view
// columns `brand_theme_gradient` / `theme_gradient_override`) only exist once
// `20280430011023_issue_1023_theme_fonts_and_gradients.sql` is applied. Until
// then an explicit select or update naming them fails with "column does not
// exist" and would break EVERY read or save that names them, not just
// gradients. These helpers retry once without the gradient column when, and
// only when, the database says that column is missing.
//
// Exit condition: the migration is applied to production. Then delete this
// file and name the columns directly at each call site.

type MaybeError = { code?: string | null; message?: string | null } | null;

/** True when an error says a gradient column is unknown to the database. */
export const isMissingGradientColumnError = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as NonNullable<MaybeError>;
  const text = typeof message === "string" ? message : "";
  return (
    (code === "42703" || code === "PGRST204" || /does not exist|could not find/i.test(text)) &&
    /theme_gradient/.test(text)
  );
};

/**
 * Runs `run(true)` (with the gradient column). If the database does not have
 * the column yet, runs `run(false)` once instead. Any other error is returned
 * unchanged.
 */
export const withGradientColumnFallback = async <R extends { error: unknown }>(
  run: (withGradient: boolean) => PromiseLike<R>,
): Promise<R> => {
  const first = await run(true);
  if (!isMissingGradientColumnError(first.error)) return first;
  return run(false);
};

/** Removes the gradient column names from a comma-separated select list. */
export const withoutGradientColumns = (select: string): string =>
  select
    .split(",")
    .filter((column) => !/theme_gradient/.test(column))
    .join(",");
