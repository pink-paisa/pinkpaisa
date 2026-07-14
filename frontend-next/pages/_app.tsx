import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/counter.css";
import "@/index.css";
import AppProviders from "@/components/AppProviders";
import { persistAffiliateAttribution } from "@/lib/affiliateTracking";

export default function PinkPaisaNextApp({ Component, pageProps }: AppProps) {
  const router = useRouter();

  useEffect(() => {
    persistAffiliateAttribution();
  }, [router.asPath]);

  return (
    <AppProviders>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <Component {...pageProps} />
    </AppProviders>
  );
}
