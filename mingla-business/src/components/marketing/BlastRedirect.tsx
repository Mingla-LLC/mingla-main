/**
 * #3872 round 2 — the brand Creators, Referrals and Promote pages moved into
 * the Blast tab. Their old routes still work: set the current brand first
 * (Blast reads `useCurrentBrand`), then replace into Blast.
 */
import React, { useEffect } from "react";
import { useRouter } from "expo-router";

import { ProgramLoading } from "../programs/ProgramKit";
import { useCurrentBrandStore } from "../../store/currentBrandStore";

export function BlastRedirect({
  brandId,
  href,
}: {
  brandId: string | null | undefined;
  href: string;
}): React.ReactElement {
  const router = useRouter();
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  useEffect(() => {
    if (brandId) setCurrentBrandId(brandId);
    router.replace(href as never);
  }, [brandId, href, router, setCurrentBrandId]);
  return <ProgramLoading />;
}
