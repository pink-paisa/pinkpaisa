import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SeoHead from "@/components/SeoHead";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

const UNSUBSCRIBE_TOKEN_SESSION_KEY = "pinkpaisa_unsubscribe_token";

export default function UnsubscribePage() {
  const router = useRouter();
  const queryToken = typeof router.query.token === "string" ? router.query.token.trim() : "";
  const [token, setToken] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!router.isReady) return;
    let storedToken = "";
    try {
      storedToken = sessionStorage.getItem(UNSUBSCRIBE_TOKEN_SESSION_KEY)?.trim() || "";
    } catch {
      storedToken = "";
    }
    const resolvedToken = queryToken || storedToken;
    if (queryToken) {
      try {
        sessionStorage.setItem(UNSUBSCRIBE_TOKEN_SESSION_KEY, queryToken);
      } catch {
        // Component state still keeps the one-time token available for this visit.
      }
      void router.replace("/unsubscribe", undefined, { shallow: true });
    }
    setToken(resolvedToken);
    setTokenReady(true);
  }, [queryToken, router]);

  const unsubscribe = async () => {
    if (!token || state === "working") return;
    setState("working");
    setMessage("");
    try {
      await apiFetch("/marketing/unsubscribe", { method: "POST", body: JSON.stringify({ token }) });
      try {
        sessionStorage.removeItem(UNSUBSCRIBE_TOKEN_SESSION_KEY);
      } catch {
        // The server-side unsubscribe succeeded even if storage is unavailable.
      }
      setState("done");
      setMessage("You have been unsubscribed from Pink Paisa marketing updates.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "We could not process this link.");
    }
  };

  return (
    <div className="min-h-screen bg-rose-soft">
      <SeoHead title="Unsubscribe" description="Manage Pink Paisa marketing email preferences." canonicalPath="/unsubscribe" noindex />
      <Navbar />
      <main className="container mx-auto py-20">
        <section className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="font-serif text-3xl">Email preferences</h1>
          {state === "done" ? (
            <p role="status" className="mt-4 text-sm leading-6 text-muted-foreground">{message}</p>
          ) : (
            <>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">Confirm below to stop roadmap and educational marketing emails. This does not affect essential transaction emails.</p>
              {tokenReady && !token ? <p role="alert" className="mt-4 text-sm text-destructive">This unsubscribe link is incomplete.</p> : null}
              {message ? <p role="alert" className="mt-4 text-sm text-destructive">{message}</p> : null}
              <Button className="mt-6" onClick={unsubscribe} disabled={!token || state === "working"}>
                {state === "working" ? "Updating…" : "Unsubscribe"}
              </Button>
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
