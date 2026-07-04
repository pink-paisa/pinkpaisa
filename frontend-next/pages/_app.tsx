import type { AppProps } from "next/app";
import "@/index.css";
import AppProviders from "@/components/AppProviders";

export default function PinkPaisaNextApp({ Component, pageProps }: AppProps) {
  return (
    <AppProviders>
      <Component {...pageProps} />
    </AppProviders>
  );
}
