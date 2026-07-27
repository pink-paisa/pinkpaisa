import { useCallback, useEffect } from "react";
import { useRouter } from "next/router";
import Script from "next/script";
import {
  getClarityProjectId,
  getClarityTags,
  isClarityBlockedPath,
  isClarityEnabled,
} from "@/lib/microsoftClarity";

declare global {
  interface Window {
    clarity?: (...args: unknown[]) => void;
  }
}

const buildClaritySnippet = (projectId: string) => `
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${projectId}");
`;

export default function MicrosoftClarity() {
  const router = useRouter();
  const enabled = isClarityEnabled();
  const projectId = getClarityProjectId();
  const blocked = isClarityBlockedPath(router.asPath);

  const applyRouteState = useCallback(() => {
    if (!enabled || typeof window === "undefined" || typeof window.clarity !== "function") return;
    if (blocked) {
      window.clarity("consent", false);
      return;
    }

    window.clarity("consent");
    const tags = getClarityTags(router.asPath);
    Object.entries(tags).forEach(([key, value]) => {
      window.clarity?.("set", key, value);
    });
  }, [blocked, enabled, router.asPath]);

  useEffect(() => {
    applyRouteState();
    const timeout = window.setTimeout(applyRouteState, 750);
    return () => window.clearTimeout(timeout);
  }, [applyRouteState]);

  if (!enabled || blocked || !projectId) return null;

  return (
    <Script
      id="microsoft-clarity"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: buildClaritySnippet(projectId) }}
      onReady={applyRouteState}
    />
  );
}
