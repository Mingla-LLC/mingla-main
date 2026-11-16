import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

const VARIANTS = {
  // #4452 §7.1: primary is ink, turning orange on hover with INK text (6.4:1;
  // white on orange is 3.0:1, §12 Q-10). Secondary has the --a-line border.
  primary:
    "bg-[var(--a-text)] text-[var(--a-panel)] border-transparent hover:bg-[var(--a-hover-bg)] hover:text-[var(--a-hover-ink)] active:bg-[var(--a-hover-bg)] active:text-[var(--a-hover-ink)]",
  secondary:
    "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border-[var(--a-line)] hover:bg-[var(--a-soft)] active:bg-[var(--a-soft)]",
  ghost:
    "bg-transparent text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--gray-100)] active:bg-[var(--gray-200)]",
  danger:
    "bg-[#ef4444] text-white border-transparent hover:bg-[#dc2626] active:bg-[#b91c1c]",
  brandContrast:
    "min-h-11 bg-[var(--color-brand-800)] text-white border-transparent hover:bg-[var(--color-brand-900)] active:bg-[var(--color-brand-900)]",
  link:
    "bg-transparent text-[var(--color-brand-500)] border-transparent hover:underline p-0 h-auto",
};

const SIZES = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-[38px] px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

export const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
    highContrastFocus = false,
    icon: Icon,
    iconRight: IconRight,
    children,
    className = "",
    ...props
  },
  ref
) {
  const isDisabled = disabled || loading;
  const isIconOnly = !children && Icon;
  const iconSize = size === "sm" ? 14 : size === "lg" ? 18 : 16;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center font-semibold border",
        "transition-all duration-150 ease-out select-none",
        highContrastFocus || variant === "brandContrast"
          ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2"
          : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
        VARIANTS[variant] || VARIANTS.primary,
        variant === "link" ? "" : SIZES[size] || SIZES.md,
        isIconOnly && variant !== "link"
          ? size === "sm" ? "!w-8 !px-0" : size === "lg" ? "!w-12 !px-0" : "!w-10 !px-0"
          : "",
        isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-[0.98] motion-reduce:active:scale-100",
        className,
      ].join(" ")}
      {...props}
    >
      {loading ? (
        <Loader2
          style={{ width: iconSize, height: iconSize }}
          className="animate-[spin_0.6s_linear_infinite]"
          aria-hidden="true"
        />
      ) : Icon ? (
        <Icon style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
      ) : null}
      {loading && !children ? null : children}
      {IconRight && !loading ? (
        <IconRight style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
      ) : null}
    </button>
  );
});
