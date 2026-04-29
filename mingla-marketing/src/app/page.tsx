/**
 * Root fallback page.
 *
 * In normal operation, middleware.ts always rewrites `/` to
 * `/_sites/[zone]/`, so this file is never rendered. It exists only so
 * Next.js doesn't error during build (App Router requires a root page).
 *
 * If middleware fails or is bypassed (e.g. unknown host with no zone match
 * — middleware's HOST_TO_ZONE has a fallback to 'umbrella' so this is
 * unreachable in practice), the user lands here.
 */
export default function RootFallback(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center p-mingla-xl text-center">
      <div>
        <h1 style={{ fontSize: 32, color: 'var(--mingla-text-inverse)' }}>Mingla</h1>
        <p className="mt-mingla-md" style={{ color: 'rgb(255 255 255 / 0.55)' }}>
          Routing unavailable. Visit{' '}
          <a href="https://usemingla.com" style={{ color: 'var(--mingla-accent)' }}>usemingla.com</a>.
        </p>
      </div>
    </div>
  );
}
