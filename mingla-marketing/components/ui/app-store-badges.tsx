import Link from 'next/link'
import { cn } from '@/lib/cn'

interface AppStoreBadgesProps {
  size?: 'md' | 'lg'
  className?: string
  iosHref?: string
  androidHref?: string
}

export function AppStoreBadges({
  size = 'md',
  className,
  iosHref = 'https://apps.apple.com/app/mingla',
  androidHref = 'https://play.google.com/store/apps/details?id=com.mingla',
}: AppStoreBadgesProps) {
  const heightClass = size === 'lg' ? 'h-14' : 'h-12'

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Link
        href={iosHref}
        aria-label="Download Mingla on the App Store"
        className={cn('focus-ring rounded-md', heightClass)}
      >
        <span
          className={cn(
            'flex items-center gap-3 rounded-md bg-ink px-5 text-text-on-dark transition-opacity hover:opacity-90',
            heightClass,
          )}
        >
          <AppleGlyph />
          <span className="flex flex-col text-left leading-tight">
            <span className="text-xs opacity-80">Download on the</span>
            <span className="text-base font-semibold">App Store</span>
          </span>
        </span>
      </Link>

      <Link
        href={androidHref}
        aria-label="Get Mingla on Google Play"
        className={cn('focus-ring rounded-md', heightClass)}
      >
        <span
          className={cn(
            'flex items-center gap-3 rounded-md bg-ink px-5 text-text-on-dark transition-opacity hover:opacity-90',
            heightClass,
          )}
        >
          <PlayGlyph />
          <span className="flex flex-col text-left leading-tight">
            <span className="text-xs opacity-80">Get it on</span>
            <span className="text-base font-semibold">Google Play</span>
          </span>
        </span>
      </Link>
    </div>
  )
}

function AppleGlyph() {
  return (
    <svg
      width="20"
      height="22"
      viewBox="0 0 20 22"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.5 16.6c-.4 1-1 2-1.7 2.7-.9.9-2 1.4-3 1.4-1 0-1.5-.5-2.7-.5s-1.7.5-2.7.5c-1 0-2.1-.5-3-1.4C2.4 18.3 1 15.6 1 13c0-3.6 2.5-5.5 5-5.5 1 0 2 .5 2.8.5.7 0 2-.6 3.3-.5 1 .1 2.5.5 3.4 1.7-.1 0-2.2 1.4-2.2 4.2 0 3.4 3 4.5 3.2 4.6 0 .1-.5 1.4-1 2.6zM12 5.4c.6-.7 1-1.7 1-2.7-1 0-2.1.6-2.7 1.3-.6.6-1.1 1.6-1 2.6 1 .1 2-.5 2.7-1.2z" />
    </svg>
  )
}

function PlayGlyph() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
      <path d="M1.7.6L11.6 11 1.7 21.4c-.4-.2-.7-.7-.7-1.3V1.9c0-.6.3-1.1.7-1.3z" fill="#34A853" />
      <path d="M14 13.4l-2.4 2.5 2 1.2c.7.4 1.5.4 2.2 0l1.6-.9c1.6-.9 1.6-2.5 0-3.4l-1.6-.9-1.8 1.5z" fill="#FBBC04" />
      <path d="M11.6 11l2.4 2.4 3.4-1.9c1.6-.9 1.6-2.5 0-3.4L14 6.2 11.6 11z" fill="#EA4335" />
      <path d="M1.7.6L11.6 11l2.4-2.4L4.3 0c-.4-.2-.9-.2-1.3-.1L1.7.6z" fill="#4285F4" />
    </svg>
  )
}
