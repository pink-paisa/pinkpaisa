import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import {
  ANALYTICS_CONSENT_EVENT,
  getAnalyticsConsent,
  setAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics";
import { isClarityBlockedPath } from "@/lib/microsoftClarity";

export default function AnalyticsConsentBanner() {
  const router = useRouter();
  const [consent, setConsentState] = useState<AnalyticsConsent>("unknown");

  useEffect(() => {
    setConsentState(getAnalyticsConsent());
    const onConsent = (event: Event) => setConsentState((event as CustomEvent<AnalyticsConsent>).detail || getAnalyticsConsent());
    window.addEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, onConsent);
  }, []);

  if (consent !== "unknown" || isClarityBlockedPath(router.asPath)) return null;
  return (
    <aside
      aria-label="Analytics preferences"
      className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-xl rounded-2xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur"
    >
      <p className="text-sm font-semibold">Help us improve Pink Paisa</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Allow privacy-conscious analytics so we can understand which quiz, product and workshop journeys are useful. Advertising storage stays off.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setAnalyticsConsent("denied")}>No thanks</Button>
        <Button type="button" size="sm" onClick={() => setAnalyticsConsent("granted")}>Allow analytics</Button>
      </div>
    </aside>
  );
}
