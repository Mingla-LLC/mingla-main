import React, { Suspense, useEffect } from "react";

import { useCommandPalette } from "../../hooks/useCommandPaletteState";

const LazyCommandPalette = React.lazy(async () => {
  const mod = await import("./CommandPalette");
  return { default: mod.CommandPalette };
});

export const CommandPaletteHost: React.FC = () => {
  const isOpen = useCommandPalette((s) => s.isOpen);
  const toggle = useCommandPalette((s) => s.toggle);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <LazyCommandPalette />
    </Suspense>
  );
};

export default CommandPaletteHost;
