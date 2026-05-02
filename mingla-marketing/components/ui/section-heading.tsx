import { cn } from '@/lib/cn'

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  lede?: string
  align?: 'left' | 'center'
  className?: string
  as?: 'h1' | 'h2'
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  className,
  as = 'h2',
}: SectionHeadingProps) {
  const Heading = as
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-coral-600">
          {eyebrow}
        </span>
      ) : null}
      <Heading
        className={cn(
          'font-display font-medium leading-[1.05] tracking-[-0.025em] text-text-primary',
          as === 'h1'
            ? 'text-4xl md:text-7xl'
            : 'text-3xl md:text-5xl',
        )}
      >
        {title}
      </Heading>
      {lede ? (
        <p
          className={cn(
            'mt-2 max-w-2xl text-base text-text-secondary md:text-lg',
            align === 'center' && 'mx-auto',
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  )
}
