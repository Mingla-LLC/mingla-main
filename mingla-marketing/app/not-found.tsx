import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-coral-600">404</span>
      <h1 className="mt-3 font-display text-5xl font-medium tracking-[-0.03em] text-text-primary md:text-7xl">
        That page slipped out the back.
      </h1>
      <p className="mt-4 max-w-xl text-text-secondary">
        We couldn&apos;t find what you were looking for. Wander back home and we&apos;ll point you somewhere good.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center rounded-full bg-coral-500 px-6 font-medium text-white transition-colors hover:bg-coral-600 focus-ring"
      >
        Take me home
      </Link>
    </section>
  )
}
