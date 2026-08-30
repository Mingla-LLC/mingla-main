"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function ExchangeContent() {
  const params = useSearchParams();
  const [state, setState] = useState<"working" | "failed">(() =>
    params.get("code") && params.get("site_id") ? "working" : "failed",
  );
  useEffect(() => {
    const code = params.get("code");
    const destination = "studio";
    const siteId = params.get("site_id");
    const returnSurface = params.get("return_surface");
    if (!code || !siteId || !["web", "native"].includes(returnSurface ?? "")) return;
    fetch("/api/mingla/exchange", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, destination, site_id: siteId, return_surface: returnSurface }),
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error();
      window.location.replace(result.data.redirect);
    }).catch(() => setState("failed"));
  }, [params]);
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#fffaf3", color: "#17120e", fontFamily: "Arial, sans-serif" }}><div style={{ maxWidth: 520 }}><p style={{ color: "#d85a22", textTransform: "uppercase", letterSpacing: ".15em", fontWeight: 800, fontSize: 12 }}>Mingla Studio</p><h1>{state === "working" ? "Opening your website…" : "This editing link has expired."}</h1><p>{state === "working" ? "We’re verifying your one-time access securely." : "Return to Mingla and choose Open Mingla Studio again. Your saved drafts are safe."}</p>{state === "failed" ? <a href="https://business.usemingla.com" style={{ display: "inline-flex", minHeight: 44, alignItems: "center", padding: "0 18px", borderRadius: 999, background: "#d85a22", color: "white", fontWeight: 700 }}>Return to Mingla</a> : null}</div></main>;
}

export default function ExchangePage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fffaf3", color: "#17120e" }}>Opening Mingla Studio…</main>}>
      <ExchangeContent />
    </Suspense>
  );
}
