import { useState, useCallback, useRef, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, RotateCcw, ShoppingBag, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import TurnstileWidget, { TURNSTILE_SITE_KEY } from "@/components/security/TurnstileWidget";
import { apiFetch } from "@/lib/api";
import { getMarketingAttribution } from "@/lib/marketingAttribution";
import { trackAnalyticsEvent } from "@/lib/analytics";
import {
  quizQuestions,
  wealthnessResults,
  calculateResult,
  type WealthnessType,
} from "@/data/quizData";

const fadeSlide = {
  initial: { opacity: 0, x: 40, filter: "blur(4px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: -40, filter: "blur(4px)" },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const WealthnessQuiz = () => {
  const [started, setStarted] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [resultType, setResultType] = useState<WealthnessType | null>(null);
  const [leadForm, setLeadForm] = useState({ first_name: "", email: "", phone: "" });
  const [emailConsent, setEmailConsent] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [leadState, setLeadState] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [leadMessage, setLeadMessage] = useState("");
  const leadIdempotencyKey = useRef(`wealthness-roadmap:${Date.now()}:${Math.random().toString(36).slice(2)}`);

  const totalQuestions = quizQuestions.length;
  const progress = (currentQ / totalQuestions) * 100;

  const handleSelect = useCallback((optionIndex: number) => {
    setSelectedOption(optionIndex);
  }, []);

  const handleNext = useCallback(() => {
    if (selectedOption === null) return;
    const newAnswers = [...answers, selectedOption];
    setAnswers(newAnswers);
    setSelectedOption(null);

    if (currentQ < totalQuestions - 1) {
      setCurrentQ((prev) => prev + 1);
    } else {
      const nextResult = calculateResult(newAnswers);
      setResultType(nextResult);
      trackAnalyticsEvent("quiz_complete", { result_type: nextResult, question_count: totalQuestions });
    }
  }, [answers, currentQ, selectedOption, totalQuestions]);

  const handleBack = useCallback(() => {
    if (currentQ <= 0) return;
    setAnswers((prev) => prev.slice(0, -1));
    setSelectedOption(null);
    setCurrentQ((prev) => prev - 1);
  }, [currentQ]);

  const handleRestart = useCallback(() => {
    setStarted(false);
    setCurrentQ(0);
    setAnswers([]);
    setSelectedOption(null);
    setResultType(null);
    setLeadForm({ first_name: "", email: "", phone: "" });
    setEmailConsent(false);
    setWhatsappConsent(false);
    setCaptchaToken(null);
    setLeadState("idle");
    setLeadMessage("");
    leadIdempotencyKey.current = `wealthness-roadmap:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }, []);

  const handleCaptchaTokenChange = useCallback((token: string | null) => setCaptchaToken(token), []);

  const handleLeadSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resultType || leadState === "submitting") return;
    if (!emailConsent) {
      setLeadState("error");
      setLeadMessage("Please confirm that we may email your roadmap.");
      return;
    }
    if (whatsappConsent && !leadForm.phone.trim()) {
      setLeadState("error");
      setLeadMessage("Add your phone number if you want WhatsApp updates.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setLeadState("error");
      setLeadMessage("Please complete the security check.");
      return;
    }
    setLeadState("submitting");
    setLeadMessage("");
    try {
      await apiFetch("/marketing/leads", {
        method: "POST",
        headers: { "Idempotency-Key": leadIdempotencyKey.current },
        body: JSON.stringify({
          result_type: resultType,
          first_name: leadForm.first_name.trim() || undefined,
          email: leadForm.email.trim(),
          phone: leadForm.phone.trim() || undefined,
          email_consent: true,
          whatsapp_consent: whatsappConsent,
          consent_version: "wealthness-roadmap-2026-08-26",
          attribution: getMarketingAttribution(),
          captcha_token: captchaToken || undefined,
        }),
      });
      setLeadState("sent");
      setLeadMessage("Your roadmap is queued for email delivery.");
      trackAnalyticsEvent("generate_lead", { lead_source: "wealthness_quiz", result_type: resultType });
    } catch (error) {
      setLeadState("error");
      setLeadMessage(error instanceof Error ? error.message : "We could not queue your roadmap. Please try again.");
    }
  }, [captchaToken, emailConsent, leadForm, leadState, resultType, whatsappConsent]);

  if (!started) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <section className="bg-rose-soft py-20 md:py-28">
          <div className="container mx-auto">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Home
            </Link>
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ staggerChildren: 0.1 }}
              className="mx-auto max-w-xl text-center"
            >
              <motion.p
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-2 text-6xl"
              >
                🧠💸🔒🔥🚀
              </motion.p>
              <motion.h1
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-4 font-serif text-3xl leading-tight md:text-4xl lg:text-5xl"
              >
                What&apos;s your Wealthness Type?
              </motion.h1>
              <motion.p
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-8 text-lg text-muted-foreground"
              >
                Answer 20 quick questions about your money habits, emotions, and goals. Get a personalized result with your strengths, blind spots, and an action plan.
              </motion.p>
              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center gap-3"
              >
                <Button variant="hero" size="xl" onClick={() => { setStarted(true); trackAnalyticsEvent("quiz_start", { quiz_name: "wealthness" }); }}>
                  Start the Quiz - It&apos;s Free
                </Button>
                <p className="text-xs text-muted-foreground">Takes about 3 minutes · No sign-up required</p>
              </motion.div>
            </motion.div>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  if (resultType) {
    const result = wealthnessResults[resultType];
    return (
      <div className="min-h-screen">
        <Navbar />
        <section className="bg-rose-soft py-16 md:py-24">
          <div className="container mx-auto">
            <motion.div
              initial="hidden"
              animate="visible"
              transition={{ staggerChildren: 0.08 }}
              className="mx-auto max-w-2xl"
            >
              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-8 text-center"
              >
                <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-primary">
                  Your Wealthness Type
                </p>
                <p className="mb-3 text-5xl">{result.emoji}</p>
                <h1 className="mb-2 font-serif text-3xl leading-tight md:text-4xl">{result.title}</h1>
                <p className="text-lg font-medium text-primary">{result.tagline}</p>
              </motion.div>

              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8"
              >
                <p className="leading-relaxed text-muted-foreground">{result.description}</p>
              </motion.div>

              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <motion.div
                  variants={fadeUp}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="rounded-2xl border border-border bg-card p-6 shadow-sm"
                >
                  <h3 className="mb-3 font-semibold text-sage">Your Strengths</h3>
                  <ul className="space-y-2">
                    {result.strengths.map((strength) => (
                      <li key={strength} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sage" />
                        {strength}
                      </li>
                    ))}
                  </ul>
                </motion.div>
                <motion.div
                  variants={fadeUp}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="rounded-2xl border border-border bg-card p-6 shadow-sm"
                >
                  <h3 className="mb-3 font-semibold text-primary">Watch Out For</h3>
                  <ul className="space-y-2">
                    {result.watchOuts.map((watchOut) => (
                      <li key={watchOut} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
                        {watchOut}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </div>

              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8"
              >
                <h3 className="mb-4 font-semibold">Your Next Steps</h3>
                <ol className="space-y-3">
                  {result.nextSteps.map((step, index) => (
                    <li key={step} className="flex items-start gap-3 text-sm">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-primary">
                        {index + 1}
                      </span>
                      <span className="text-muted-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
              </motion.div>

              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="mb-6 rounded-2xl border border-primary/20 bg-card p-6 shadow-sm md:p-8"
              >
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">Optional next step</p>
                <h3 className="mt-2 font-serif text-2xl">Email my personal roadmap</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Your result is already above. If you want a copy of the action plan, opt in below. WhatsApp updates are separate and optional.
                </p>
                {leadState === "sent" ? (
                  <div role="status" className="mt-5 rounded-xl bg-sage/10 p-4 text-sm font-medium text-sage">{leadMessage}</div>
                ) : (
                  <form className="mt-5 space-y-4" onSubmit={handleLeadSubmit}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-sm">
                        <span className="font-medium">First name</span>
                        <input
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
                          value={leadForm.first_name}
                          onChange={(event) => setLeadForm((current) => ({ ...current, first_name: event.target.value }))}
                          autoComplete="given-name"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span className="font-medium">Email *</span>
                        <input
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
                          type="email"
                          required
                          value={leadForm.email}
                          onChange={(event) => setLeadForm((current) => ({ ...current, email: event.target.value }))}
                          autoComplete="email"
                        />
                      </label>
                    </div>
                    <label className="flex items-start gap-3 text-sm leading-5">
                      <input type="checkbox" className="mt-1" checked={emailConsent} onChange={(event) => setEmailConsent(event.target.checked)} />
                      <span>Email me this roadmap and related Pink Paisa educational updates. I can unsubscribe at any time.</span>
                    </label>
                    <label className="flex items-start gap-3 text-sm leading-5">
                      <input type="checkbox" className="mt-1" checked={whatsappConsent} onChange={(event) => setWhatsappConsent(event.target.checked)} />
                      <span>Also send occasional WhatsApp education updates (optional).</span>
                    </label>
                    {whatsappConsent ? (
                      <label className="block space-y-1 text-sm">
                        <span className="font-medium">WhatsApp number *</span>
                        <input
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-primary/30"
                          type="tel"
                          required
                          value={leadForm.phone}
                          onChange={(event) => setLeadForm((current) => ({ ...current, phone: event.target.value }))}
                          autoComplete="tel"
                        />
                      </label>
                    ) : null}
                    <TurnstileWidget action="wealthness_lead" onTokenChange={handleCaptchaTokenChange} />
                    {leadMessage ? <p role="alert" className="text-sm text-destructive">{leadMessage}</p> : null}
                    <Button type="submit" variant="hero" disabled={leadState === "submitting" || (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)}>
                      {leadState === "submitting" ? "Queuing roadmap…" : "Email my roadmap"}
                    </Button>
                    <p className="text-xs leading-5 text-muted-foreground">We store your result type and contact/consent details, not your 20 quiz answers.</p>
                  </form>
                )}
              </motion.div>

              <motion.div
                variants={fadeUp}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl bg-primary p-6 text-primary-foreground shadow-lg shadow-primary/20 md:p-8"
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest opacity-70">Explore next</p>
                <h3 className="mb-2 font-serif text-xl md:text-2xl">Curated Pink Paisa picks</h3>
                <p className="mb-5 text-sm leading-relaxed opacity-90">
                  Browse the current, link-checked recommendations selected by Pink Paisa. Product links may be affiliate links.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="hero-outline"
                    size="lg"
                    className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary"
                    asChild
                  >
                    <Link href="/instagram/picks">
                      <ShoppingBag className="mr-2 h-4 w-4" /> Browse curated picks
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    onClick={handleRestart}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Retake Quiz
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  const question = quizQuestions[currentQ];

  return (
    <div className="min-h-screen">
      <Navbar />
      <section className="bg-rose-soft py-12 md:py-20">
        <div className="container mx-auto">
          <div className="mx-auto max-w-xl">
            <div className="mb-8">
              <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>Question {currentQ + 1} of {totalQuestions}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-cream-dark">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={false}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={currentQ}
                variants={fadeSlide}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <h2 className="mb-8 font-serif text-xl leading-snug md:text-2xl">{question.question}</h2>

                <div className="space-y-3">
                  {question.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => handleSelect(index)}
                      className={`w-full rounded-xl border-2 p-4 text-left text-sm leading-relaxed transition-all duration-200 active:scale-[0.98] ${
                        selectedOption === index
                          ? "border-primary bg-primary/5 font-medium text-foreground shadow-sm"
                          : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:bg-card"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            selectedOption === index ? "border-primary bg-primary" : "border-border"
                          }`}
                        >
                          {selectedOption === index ? <Check className="h-3.5 w-3.5 text-primary-foreground" /> : null}
                        </div>
                        {option.text}
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={handleBack}
                disabled={currentQ === 0}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <Button variant="hero" size="lg" onClick={handleNext} disabled={selectedOption === null}>
                {currentQ === totalQuestions - 1 ? "See My Results" : "Next"}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default WealthnessQuiz;
