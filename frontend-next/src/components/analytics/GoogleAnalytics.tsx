import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { useRouter } from "next/router";
import {
  ANALYTICS_CONSENT_EVENT,
  flushPendingAnalyticsEvents,
  getAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics";
import {
  isAnalyticsBlockedPath,
  sanitizeAnalyticsLocation,
  sanitizeAnalyticsPath,
} from "@/lib/privacySafeUrl";

function measurementId() {
  const value = String(process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || "").trim().toUpperCase();
  return /^G-[A-Z0-9]+$/.test(value) ? value : "";
}

export default function GoogleAnalytics() {
  const router = useRouter();
  const [consent, setConsent] = useState<AnalyticsConsent>("unknown");
  const [scriptReady, setScriptReady] = useState(false);
  const initializedRef = useRef(false);
  const lastPageViewRef = useRef("");
  const id = measurementId();
  const blocked = isAnalyticsBlockedPath(router.asPath);
  const pagePath = sanitizeAnalyticsPath(router.asPath);

  useEffect(() => {
    setConsent(getAnalyticsConsent());
    const onConsent = (event: Event) => setConsent((event as CustomEvent<AnalyticsConsent>).detail || getAnalyticsConsent());
    window.addEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
  }, []);

  const configure = useCallback(() => {
    if (!id || blocked || consent !== "granted" || !scriptReady || typeof window === "undefined") return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag(...args: unknown[]) { window.dataLayer?.push(args); };
    if (!initializedRef.current) {
      window.gtag("consent", "default", {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      window.gtag("js", new Date());
      window.gtag("config", id, {
        send_page_view: false,
        anonymize_ip: true,
      });
      initializedRef.current = true;
    }
    if (lastPageViewRef.current === pagePath) return;
    window.gtag("event", "page_view", {
      page_path: pagePath,
      page_location: sanitizeAnalyticsLocation(window.location.href),
      page_title: document.title,
    });
    flushPendingAnalyticsEvents();
    lastPageViewRef.current = pagePath;
  }, [blocked, consent, id, pagePath, scriptReady]);

  useEffect(() => {
    configure();
  }, [configure]);

  if (!id || blocked || consent !== "granted") return null;
  return (
    <Script
      id="pinkpaisa-ga4"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
      strategy="afterInteractive"
      onLoad={() => setScriptReady(true)}
      onReady={() => setScriptReady(true)}
    />
  );
}
