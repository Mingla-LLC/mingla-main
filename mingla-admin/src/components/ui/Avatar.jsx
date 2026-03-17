import { useState } from "react";

const SIZES = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-xl",
  xl: "w-20 h-20 text-[28px]",
};

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0][0].toUpperCase();
}

function InitialsFallback({ name, size, bordered = false }) {
  return (
    <div
      aria-label={name || "Avatar"}
      className={[
        "rounded-full flex items-center justify-center font-semibold shrink-0",
        "bg-[#ffedd5] text-[#c2410c]",
        SIZES[size] || SIZES.md,
        bordered ? "border-2 border-[var(--color-background-primary)]" : "",
      ].join(" ")}
    >
      {getInitials(name)}
    </div>
  );
}

export function Avatar({ src, name, size = "md", bordered = false }) {
  const [imgError, setImgError] = useState(false);

  if (!src || imgError) {
    return <InitialsFallback name={name} size={size} bordered={bordered} />;
  }

  return (
    <img
      src={src}
      alt={name || "Avatar"}
      onError={() => setImgError(true)}
      className={[
        "rounded-full object-cover shrink-0",
        SIZES[size] || SIZES.md,
        bordered ? "border-2 border-[var(--color-background-primary)]" : "",
      ].join(" ")}
    />
  );
}

export function AvatarGroup({ items, max = 4, size = "sm" }) {
  const visible = items.slice(0, max);
  const overflow = items.length - max;

  return (
    <div className="flex items-center">
      {visible.map((item, i) => (
        <div key={i} className={i > 0 ? "-ml-2" : ""}>
          <Avatar src={item.src} name={item.name} size={size} bordered />
        </div>
      ))}
      {overflow > 0 && (
        <div
          className={[
            "-ml-2 rounded-full flex items-center justify-center font-semibold shrink-0",
            "bg-[var(--gray-100)] text-[var(--gray-600)]",
            "border-2 border-[var(--color-background-primary)]",
            SIZES[size] || SIZES.sm,
          ].join(" ")}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
