import React, { Suspense } from "react";

import { useGlobalSearchSheet } from "../../hooks/useGlobalSearchSheet";

const LazyGlobalSearchSheet = React.lazy(async () => {
  const mod = await import("./GlobalSearchSheet");
  return { default: mod.GlobalSearchSheet };
});

export const GlobalSearchSheetHost: React.FC = () => {
  const isOpen = useGlobalSearchSheet((s) => s.isOpen);
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <LazyGlobalSearchSheet />
    </Suspense>
  );
};

export default GlobalSearchSheetHost;
