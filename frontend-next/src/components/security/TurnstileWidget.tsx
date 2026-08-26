import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SITE_KEY = String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();

type Props = {
  action: string;
  onTokenChange: (token: string | null) => void;
  className?: string;
};

export default function TurnstileWidget({ action, onTokenChange, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (window.turnstile) setScriptReady(true);
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !scriptReady || !window.turnstile || !containerRef.current) return undefined;
    if (widgetIdRef.current) window.turnstile.remove(widgetIdRef.current);
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      action,
      theme: "light",
      callback: (token: string) => onTokenChange(token),
      "expired-callback": () => onTokenChange(null),
      "error-callback": () => onTokenChange(null),
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
      onTokenChange(null);
    };
  }, [action, onTokenChange, scriptReady]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <div className={className}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} aria-label="Security verification" />
    </div>
  );
}
