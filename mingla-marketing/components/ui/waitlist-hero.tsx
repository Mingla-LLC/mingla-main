'use client'
import { useRef, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'

type Status = 'idle' | 'loading' | 'success'

interface WaitlistHeroProps {
  /**
   * Called with the submitted email. If absent, the form simulates a 1.5s
   * latency and always succeeds (placeholder until the waitlist endpoint
   * is wired). Throw to surface an error.
   */
  onSubmit?: (email: string) => Promise<void>
  title?: string
  subtitle?: string
  /** Visible monogram inside the rounded badge above the title. */
  monogram?: string
  buttonLabel?: string
  successLabel?: string
}

// Mingla brand confetti palette
const CONFETTI_COLORS = ['#f97316', '#ea580c', '#f4d679', '#5C7A5A', '#f5f0ea']

export function WaitlistHero({
  onSubmit,
  title = 'Be first when Mingla Business opens.',
  subtitle = 'Get early access — list your venue, your events, and your activations on the experience app explorers actually use.',
  monogram = 'M',
  buttonLabel = 'Join early access',
  successLabel = "You're on the list!",
}: WaitlistHeroProps) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!email || status === 'loading') return
    setStatus('loading')

    try {
      if (onSubmit) {
        await onSubmit(email)
      } else {
        await new Promise((r) => setTimeout(r, 1500))
      }
      setStatus('success')
      setEmail('')
      fireConfetti()
    } catch {
      // Surface failure: drop back to idle so user can retry.
      // [TRANSITIONAL] swap to a real error toast once the endpoint exists.
      setStatus('idle')
    }
  }

  const fireConfetti = (): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight

    interface Particle {
      x: number
      y: number
      vx: number
      vy: number
      life: number
      color: string
      size: number
    }

    const particles: Particle[] = Array.from({ length: 60 }, () => ({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 2) * 10,
      life: 100,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? '#f97316',
      size: Math.random() * 4 + 2,
    }))

    const animate = (): void => {
      if (particles.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        if (!p) continue
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.5
        p.life -= 2
        ctx.fillStyle = p.color
        ctx.globalAlpha = Math.max(0, p.life / 100)
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        if (p.life <= 0) particles.splice(i, 1)
      }
      requestAnimationFrame(animate)
    }
    animate()
  }

  return (
    <div data-cinematic="dark" className="flex min-h-screen w-full items-center justify-center bg-smoke">
      <style>{`
        @keyframes mingla-spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes mingla-spin-slow-rev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes mingla-bounce-in {
          0% { transform: scale(0.8); opacity: 0; }
          50% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes mingla-success-pulse {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.1); }
          70% { transform: scale(0.95); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes mingla-success-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(63, 139, 92, 0.4); }
          50% { box-shadow: 0 0 60px rgba(63, 139, 92, 0.7), 0 0 100px rgba(63, 139, 92, 0.35); }
        }
        @keyframes mingla-checkmark-draw { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
        @keyframes mingla-celebration-ring {
          0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .mingla-spin-slow, .mingla-spin-slow-rev { animation: none !important; }
        }
      `}</style>

      <div className="relative h-screen w-full overflow-hidden">
        {/* Decorative gradient orbs — replace original spinning placeholder photos */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            perspective: '1200px',
            transform: 'perspective(1200px) rotateX(15deg)',
            transformOrigin: 'center bottom',
          }}
          aria-hidden="true"
        >
          <div className="mingla-spin-slow absolute inset-0" style={{ animation: 'mingla-spin-slow 80s linear infinite' }}>
            <div
              className="absolute left-1/2 top-1/2 h-[2000px] w-[2000px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-50"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(249,115,22,0.45), rgba(249,115,22,0))',
              }}
            />
          </div>
          <div className="mingla-spin-slow-rev absolute inset-0" style={{ animation: 'mingla-spin-slow-rev 60s linear infinite' }}>
            <div
              className="absolute left-1/2 top-1/2 h-[1100px] w-[1100px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(244,214,121,0.40), rgba(244,214,121,0))',
              }}
            />
          </div>
          <div className="mingla-spin-slow absolute inset-0" style={{ animation: 'mingla-spin-slow 50s linear infinite' }}>
            <div
              className="absolute left-1/2 top-1/2 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(92,122,90,0.35), rgba(92,122,90,0))',
              }}
            />
          </div>
        </div>

        {/* Bottom-up gradient overlay (smoke fade) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            background:
              'linear-gradient(to top, var(--color-smoke) 10%, rgba(26,15,31,0.8) 40%, transparent 100%)',
          }}
        />

        {/* Foreground content */}
        <div className="relative z-20 flex h-full w-full flex-col items-center justify-end gap-6 pb-24">
          {/* Mingla badge */}
          <div className="mb-2 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-coral-500 shadow-lg ring-1 ring-white/10">
            <span className="font-display text-3xl font-semibold text-white">{monogram}</span>
          </div>

          <h1 className="px-6 text-center font-display text-4xl font-medium leading-[1.05] tracking-[-0.03em] text-text-on-dark md:text-6xl">
            {title}
          </h1>

          <p className="max-w-xl px-6 text-center text-base text-text-on-dark/70 md:text-lg">
            {subtitle}
          </p>

          {/* Form / Success container */}
          <div className="relative mt-4 h-[60px] w-full max-w-md px-4">
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 z-50 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2"
            />

            {/* SUCCESS STATE */}
            <div
              className={`absolute inset-0 flex items-center justify-center rounded-full transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                status === 'success'
                  ? 'pointer-events-auto scale-100 opacity-100'
                  : 'pointer-events-none scale-95 opacity-0'
              }`}
              style={{
                backgroundColor: 'var(--color-success)',
                animation: status === 'success' ? 'mingla-success-pulse 0.6s cubic-bezier(0.175,0.885,0.32,1.275) forwards, mingla-success-glow 2s ease-in-out infinite' : undefined,
              }}
            >
              {status === 'success' ? (
                <>
                  <div
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 h-full w-full rounded-full border-2 border-success/70"
                    style={{ animation: 'mingla-celebration-ring 0.8s ease-out forwards' }}
                  />
                  <div
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 h-full w-full rounded-full border-2 border-success/50"
                    style={{ animation: 'mingla-celebration-ring 0.8s ease-out 0.15s forwards' }}
                  />
                </>
              ) : null}
              <div
                className="flex items-center gap-2 text-lg font-semibold text-white"
                style={{ animation: status === 'success' ? 'mingla-bounce-in 0.5s cubic-bezier(0.175,0.885,0.32,1.275) forwards' : undefined }}
              >
                <span className="rounded-full bg-white/20 p-1">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                      style={{
                        strokeDasharray: 24,
                        strokeDashoffset: status === 'success' ? 0 : 24,
                        animation: status === 'success' ? 'mingla-checkmark-draw 0.4s ease-out 0.3s forwards' : undefined,
                      }}
                    />
                  </svg>
                </span>
                <span>{successLabel}</span>
              </div>
            </div>

            {/* FORM STATE */}
            <form
              onSubmit={handleSubmit}
              aria-label="Mingla Business early access waitlist"
              className={`relative h-full w-full transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                status === 'success'
                  ? 'pointer-events-none scale-95 opacity-0'
                  : 'pointer-events-auto scale-100 opacity-100'
              }`}
            >
              <label htmlFor="mingla-waitlist-email" className="sr-only">
                Email address
              </label>
              <input
                id="mingla-waitlist-email"
                type="email"
                required
                autoComplete="email"
                placeholder="name@email.com"
                value={email}
                disabled={status === 'loading'}
                onChange={(e) => setEmail(e.target.value)}
                className="h-[60px] w-full rounded-full bg-white/[0.10] pl-6 pr-[160px] text-text-on-dark placeholder-white/40 outline-none ring-1 ring-inset ring-white/15 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-coral-500 disabled:cursor-not-allowed disabled:opacity-70"
              />

              <div className="absolute bottom-[6px] right-[6px] top-[6px]">
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="flex h-full min-w-[150px] cursor-pointer items-center justify-center rounded-full bg-coral-500 px-6 font-medium text-white transition-all hover:bg-coral-600 active:scale-95 disabled:cursor-wait disabled:hover:bg-coral-500 focus-ring"
                >
                  {status === 'loading' ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    buttonLabel
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
