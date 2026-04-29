import { cn } from '@/lib/cn';

type ContainerProps = {
  children: React.ReactNode;
  className?: string;
  /** Max width preset. Defaults to 'lg' (~1152px). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const SIZE_CLASS = {
  sm: 'max-w-3xl',  // ~768px
  md: 'max-w-5xl',  // ~1024px
  lg: 'max-w-6xl',  // ~1152px
  xl: 'max-w-7xl',  // ~1280px
} as const;

/**
 * Standard max-width wrapper with consistent gutters.
 * Use everywhere for page-level horizontal centering.
 */
export function Container({ children, className, size = 'lg' }: ContainerProps): React.ReactElement {
  return (
    <div className={cn('mx-auto w-full px-mingla-md sm:px-mingla-lg', SIZE_CLASS[size], className)}>
      {children}
    </div>
  );
}
