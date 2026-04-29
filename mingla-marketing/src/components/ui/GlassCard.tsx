import { cn } from '@/lib/cn';

type GlassCardProps = {
  children: React.ReactNode;
  className?: string;
  /** 'standard' = profile.card, 'elevated' = profile.cardElevated. */
  variant?: 'standard' | 'elevated';
};

const VARIANT_STYLE = {
  standard: {
    background: 'rgb(255 255 255 / 0.04)',
    border: '1px solid rgb(255 255 255 / 0.08)',
    borderRadius: 'var(--mingla-radius-xl)',
    boxShadow: '0 4px 16px rgb(0 0 0 / 0.30)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
  },
  elevated: {
    background: 'rgb(255 255 255 / 0.06)',
    border: '1px solid rgb(255 255 255 / 0.12)',
    borderRadius: 'var(--mingla-radius-xl)',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.42)',
    backdropFilter: 'blur(34px)',
    WebkitBackdropFilter: 'blur(34px)',
  },
} as const;

/**
 * Glass surface card — mirrors `glass.profile.card` / `glass.profile.cardElevated`
 * from the mobile design system. Use for content containers throughout the
 * marketing sites (testimonials, feature blocks, pricing cards in Phase 4).
 */
export function GlassCard({ children, className, variant = 'standard' }: GlassCardProps): React.ReactElement {
  return (
    <div className={cn('p-mingla-lg', className)} style={VARIANT_STYLE[variant]}>
      {children}
    </div>
  );
}
