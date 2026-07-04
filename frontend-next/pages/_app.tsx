import type { AppProps } from "next/app";
import { useEffect } from "react";
import { useRouter } from "next/router";
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
      <Component {...pageProps} />
    </AppProviders>
  );
}
