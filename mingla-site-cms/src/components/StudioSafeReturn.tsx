"use client";

import { useEffect } from "react";

export default function StudioSafeReturn({
  returnUrl,
  title,
  body,
}: {
  returnUrl: string;
  title: string;
  body: string;
}) {
  useEffect(() => {
    window.location.replace(returnUrl);
  }, [returnUrl]);
  return (
    <main className="studio-safe-return">
      <div>
        <p className="studio-eyebrow">Mingla Studio</p>
        <h1>{title}</h1>
        <p>{body}</p>
        <a className="studio-primary-button" href={returnUrl}>
          Return to Mingla
        </a>
      </div>
    </main>
  );
}
