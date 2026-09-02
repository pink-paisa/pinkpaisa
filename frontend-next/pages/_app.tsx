import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/counter.css";
import "@/index.css";
import AppProviders from "@/components/AppProviders";
import MicrosoftClarity from "@/components/analytics/MicrosoftClarity";
import GoogleAnalytics from "@/components/analytics/GoogleAnalytics";
import AnalyticsConsentBanner from "@/components/analytics/AnalyticsConsentBanner";
import { persistAffiliateAttribution } from "@/lib/affiliateTracking";
import { persistMarketingAttribution } from "@/lib/marketingAttribution";
import { isClarityBlockedPath } from "@/lib/microsoftClarity";
import { fontFaceVariables } from "@/lib/fonts";

export default function PinkPaisaNextApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const maskPageForClarity = isClarityBlockedPath(router.asPath);

  useEffect(() => {
    persistAffiliateAttribution();
    persistMarketingAttribution();
  }, [router.asPath]);

  return (
    <AppProviders>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      {/* Declared on :root so portalled UI (dialogs, sheets, toasts) inherits the type system. */}
      <style jsx global>{`
        :root {
          --font-dm-sans: ${fontFaceVariables["--font-dm-sans"]};
          --font-dm-serif: ${fontFaceVariables["--font-dm-serif"]};
        }
      `}</style>
      <MicrosoftClarity />
      <GoogleAnalytics />
      {maskPageForClarity ? (
        <div data-clarity-mask="true">
          <Component {...pageProps} />
        </div>
      ) : (
        <Component {...pageProps} />
      )}
      <AnalyticsConsentBanner />
    </AppProviders>
  );
}
