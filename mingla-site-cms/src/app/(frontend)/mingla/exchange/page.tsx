"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MINGLA_BUSINESS_ORIGIN } from "../../../../lib/origins";

function ExchangeContent() {
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "failed">(() =>
    params.get("code") && params.get("site_id") && params.get("brand_id")
      ? "working"
      : "failed",
  );
  const [returnUrl, setReturnUrl] = useState(MINGLA_BUSINESS_ORIGIN);
  useEffect(() => {
    const code = params.get("code");
    const destination = "studio";
    const siteId = params.get("site_id");
    const brandId = params.get("brand_id");
    const returnSurface = params.get("return_surface");
    if (!code || !siteId || !brandId || !["web", "native"].includes(returnSurface ?? "")) return;
    fetch("/api/mingla/exchange", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, destination, site_id: siteId, brand_id: brandId, return_surface: returnSurface }),
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (typeof result?.error?.return_url === "string") {
          setReturnUrl(result.error.return_url);
          window.location.replace(result.error.return_url);
        }
        throw new Error();
      }
      window.location.replace(result.data.redirect);
    }).catch(() => setState("failed"));
  }, [params]);
  return <main className="studio-safe-return"><div><p className="studio-eyebrow">Mingla Studio</p><h1>{state === "working" ? "Opening your website…" : "This editing link has expired."}</h1><p>{state === "working" ? "We’re verifying your one-time access securely." : "Return to Mingla and choose Open Mingla Studio again. Your saved drafts are safe."}</p>{state === "failed" ? <a className="studio-primary-button" href={returnUrl}>Return to Mingla</a> : null}</div></main>;
}

export default function ExchangePage() {
  return (
    <Suspense fallback={<main className="studio-safe-return">Opening Mingla Studio…</main>}>
      <ExchangeContent />
    </Suspense>
  );
}
