import { cn } from '@/lib/cn';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'glass';
  size?: 'md' | 'lg';
  asChild?: never;
};

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: 'primary' | 'secondary' | 'glass';
  size?: 'md' | 'lg';
  href: string;
};

const SIZE_CLASS = {
  md: 'h-11 px-mingla-md text-mingla-md',
  lg: 'h-14 px-mingla-lg text-mingla-lg',
} as const;

const VARIANT_STYLE = {
  primary: {
    background: 'var(--mingla-accent)',
    color: '#ffffff',
    border: '1px solid transparent',
  },
  secondary: {
    background: 'rgb(255 255 255 / 0.06)',
    color: '#ffffff',
    border: '1px solid rgb(255 255 255 / 0.12)',
  },
  glass: {
    background: 'var(--mingla-chrome-tint-floor)',
    color: '#ffffff',
    border: '1px solid var(--mingla-chrome-hairline)',
    backdropFilter: 'blur(28px)',
  },
} as const;

const baseClasses = cn(
  'inline-flex items-center justify-center gap-2',
  'font-medium no-underline rounded-mingla-lg',
  'transition-transform duration-150 ease-out',
  'hover:scale-[1.02] active:scale-[0.97]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mingla-accent focus-visible:ring-offset-2 focus-visible:ring-offset-mingla-canvas'
);

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps): React.ReactElement {
  return (
    <button
      className={cn(baseClasses, SIZE_CLASS[size], className)}
      style={VARIANT_STYLE[variant]}
      {...props}
    >
      {children}
    </button>
  );
}

/** Anchor-styled-as-button. Use for navigation; button for actions. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: LinkProps): React.ReactElement {
  return (
    <a
      className={cn(baseClasses, SIZE_CLASS[size], className)}
      style={VARIANT_STYLE[variant]}
      {...props}
    >
      {children}
    </a>
  );
}
