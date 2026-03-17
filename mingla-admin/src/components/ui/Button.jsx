import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

const VARIANTS = {
  primary:
    "bg-[var(--color-brand-500)] text-white border-transparent hover:bg-[var(--color-brand-600)] active:bg-[var(--color-brand-700)]",
  secondary:
    "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] border-[var(--gray-300)] hover:bg-[var(--gray-50)] active:bg-[var(--gray-100)]",
  ghost:
    "bg-transparent text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--gray-100)] active:bg-[var(--gray-200)]",
  danger:
    "bg-[#ef4444] text-white border-transparent hover:bg-[#dc2626] active:bg-[#b91c1c]",
  link:
    "bg-transparent text-[var(--color-brand-500)] border-transparent hover:underline p-0 h-auto",
};

const SIZES = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
};

export const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    disabled = false,
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
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] focus-visible:ring-offset-2",
        VARIANTS[variant] || VARIANTS.primary,
        variant === "link" ? "" : SIZES[size] || SIZES.md,
        isIconOnly && variant !== "link"
          ? size === "sm" ? "!w-8 !px-0" : size === "lg" ? "!w-12 !px-0" : "!w-10 !px-0"
          : "",
        isDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-[0.98]",
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
