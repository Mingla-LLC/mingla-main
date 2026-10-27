"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function ExchangeContent({ businessOrigin }: { businessOrigin: string }) {
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "failed">(() =>
    params.get("code") && params.get("site_id") && params.get("brand_id")
      ? "working"
      : "failed",
  );
  const [returnUrl, setReturnUrl] = useState(businessOrigin);
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
      // #2829 W9r — the Business app's per-page "Edit" opens that page's
      // editor (a page of another site simply isn't found in this session).
      const page = params.get("page");
      window.location.replace(page && /^[A-Za-z0-9-]{1,64}$/.test(page)
        ? `/admin/collections/pages/${encodeURIComponent(page)}`
        : result.data.redirect);
    }).catch(() => setState("failed"));
  }, [params]);
  return <main className="studio-safe-return"><div><p className="studio-eyebrow">Mingla Studio</p><h1>{state === "working" ? "Opening your website…" : "This editing link has expired."}</h1><p>{state === "working" ? "We’re verifying your one-time access securely." : "Return to Mingla and choose Open Mingla Studio again. Your saved drafts are safe."}</p>{state === "failed" ? <a className="studio-primary-button" href={returnUrl}>Return to Mingla</a> : null}</div></main>;
}

/** #2829 W9f — the fallback "Return to Mingla" is the configured Business origin. */
export default function ExchangeClient({ businessOrigin }: { businessOrigin: string }) {
  return (
    <Suspense fallback={<main className="studio-safe-return">Opening Mingla Studio…</main>}>
      <ExchangeContent businessOrigin={businessOrigin} />
    </Suspense>
  );
}
