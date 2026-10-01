"use client";

import { useEffect, useState, type ReactNode } from "react";

/** A native save link; the browser owns download handling and its context menu. */
export function DownloadLink({ name, text, className, children }: {
  name: string; text: string; className?: string; children: ReactNode;
}) {
  const [resource, setResource] = useState<{ text: string; url: string } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    setResource({ text, url });
    return () => { setTimeout(() => URL.revokeObjectURL(url), 30000); };
  }, [text]);
  const href = resource?.text === text ? resource.url : undefined;
  return <a className={className} href={href} download={name} aria-disabled={!href}>{children}</a>;
}
