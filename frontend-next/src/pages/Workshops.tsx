/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Clock, Users, ArrowLeft, Star, ChevronRight, Building2, UsersRound, Sparkles, Zap, Award, Briefcase, Compass, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WorkshopQuoteModal from "@/components/WorkshopQuoteModal";
import { useWorkshops, type Workshop } from "@/hooks/useWorkshops";
import * as Icons from "lucide-react";

const ICON_MAP: Record<string, any> = {
  Award, Dumbbell: Icons.Dumbbell, Heart: Icons.Heart, Zap, Brain: Icons.Brain,
  Shield: Icons.Shield, Users, MessageCircle, Compass, Briefcase, Flame: Icons.Flame, Sparkles,
};

const workshopCategories = ["All", "Corporate", "Group", "Bundle"] as const;
type WorkshopCategoryType = typeof workshopCategories[number];

const corporateBenefits = [
  { label: "Time Management", icon: Clock },
  { label: "Increasing Productivity", icon: Zap },
  { label: "Career Enhancements", icon: Briefcase },
  { label: "Identifying Core Strengths", icon: Compass },
  { label: "Maximizing Potential", icon: Award },
  { label: "Improving Communication", icon: MessageCircle },
];

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const WorkshopCard = ({ ws, index }: { ws: Workshop; index: number }) => {
  const IconComp = ICON_MAP[ws.icon] || Sparkles;
  const benefits = Array.isArray(ws.benefits) ? ws.benefits : [];

  return (
    <motion.div
      variants={fadeUp}
      transition={{ duration: 0.5, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative flex flex-col rounded-2xl border bg-card shadow-sm transition-shadow duration-300 hover:shadow-xl hover:shadow-primary/8 ${
        ws.popular ? "border-primary/30 ring-1 ring-primary/10" : "border-border"
      }`}
    >
      {ws.popular && (
        <div className="absolute -top-3 right-4 flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/20">
          <Star className="h-3 w-3" /> Popular
        </div>
      )}

      <div className="flex flex-1 flex-col p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-accent">
            <IconComp className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <span className="mb-1 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {ws.category}
            </span>
            <h3 className="font-semibold leading-snug">{ws.title}</h3>
          </div>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{ws.short_description}</p>

        {benefits.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {benefits.map((b: string) => (
              <li key={b} className="flex items-center gap-2 text-sm font-medium text-sage">
                <ChevronRight className="h-3.5 w-3.5" /> {b}
              </li>
            ))}
          </ul>
        )}

        <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {ws.duration}</span>
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Min. {ws.min_people} people</span>
        </div>

        <div className="mt-auto">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="font-serif text-2xl font-bold text-foreground">₹{ws.price.toLocaleString("en-IN")}</span>
            {ws.original_price && (
              <span className="text-sm text-muted-foreground line-through">₹{ws.original_price.toLocaleString("en-IN")}</span>
            )}
          </div>
          {ws.discount_text && <p className="text-xs font-semibold text-primary mb-2">{ws.discount_text}</p>}
          <Button variant="product" size="lg" asChild>
            <Link href={`/workshop-booking?workshop=${ws.slug}`}>Book This Workshop</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

const Workshops = ({ initialWorkshops }: { initialWorkshops?: Workshop[] }) => {
  const [activeCategory, setActiveCategory] = useState<WorkshopCategoryType>("All");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const gridRef = useRef(null);
  const benefitsRef = useRef(null);
  const benefitsInView = useInView(benefitsRef, { once: true, amount: 0.2 });

  const { data: workshops, isLoading } = useWorkshops(false, initialWorkshops);

  const filtered = useMemo(() => {
    if (!workshops) return [];
    if (activeCategory === "All") return workshops;
    return workshops.filter((w) => w.category === activeCategory);
  }, [activeCategory, workshops]);

  const categoryCounts = useMemo(() => {
    if (!workshops) return {};
    return {
      Corporate: workshops.filter((w) => w.category === "Corporate").length,
      Group: workshops.filter((w) => w.category === "Group").length,
      Bundle: workshops.filter((w) => w.category === "Bundle").length,
    };
  }, [workshops]);

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="bg-rose-soft py-16 md:py-24">
        <div className="container mx-auto">
          <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Home
          </Link>
          <motion.div initial="hidden" animate="visible" transition={{ staggerChildren: 0.1 }} className="max-w-2xl">
            <motion.p variants={fadeUp} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              Workshops & Experiences
            </motion.p>
            <motion.h1 variants={fadeUp} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="mb-4 font-serif text-3xl leading-tight md:text-4xl lg:text-5xl">
              Wellness workshops for organizations & groups
            </motion.h1>
            <motion.p variants={fadeUp} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="mb-8 text-lg text-muted-foreground">
              Specially developed sessions covering physical, emotional, and financial wellbeing. For every corporate workshop purchased, Pink Paisa sponsors a complimentary workshop at a university.
            </motion.p>
            <motion.div variants={fadeUp} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="flex flex-wrap gap-4">
              <Button variant="hero" size="xl" asChild><a href="#workshop-list">Explore Workshops</a></Button>
              <Button variant="hero-outline" size="xl" onClick={() => setQuoteOpen(true)}>Get a Custom Quote</Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Social impact bar */}
      <section className="border-b border-border bg-card py-5">
        <div className="container mx-auto flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-primary" /><span>1 Corporate Workshop</span>
          </div>
          <span className="text-xl font-bold text-primary">=</span>
          <div className="flex items-center gap-2 text-sm font-medium">
            <UsersRound className="h-4 w-4 text-sage" /><span>1 Free Workshop for a university</span>
          </div>
          <span className="ml-2 text-xs text-muted-foreground">Powered by you.</span>
        </div>
      </section>

      {/* Corporate benefits */}
      <section className="bg-background py-14 md:py-20">
        <div className="container mx-auto">
          <motion.div ref={benefitsRef} initial="hidden" animate={benefitsInView ? "visible" : "hidden"} transition={{ staggerChildren: 0.08 }}>
            <motion.h2 variants={fadeUp} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="mb-10 text-center font-serif text-2xl md:text-3xl">
              Benefits of our workshops
            </motion.h2>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
              {corporateBenefits.map((b, i) => {
                const BIcon = b.icon;
                return (
                  <motion.div key={b.label} variants={fadeUp} transition={{ duration: 0.5, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col items-center gap-3 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent shadow-sm">
                      <BIcon className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-sm font-medium leading-tight">{b.label}</p>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Workshop list */}
      <section id="workshop-list" className="bg-rose-soft py-14 md:py-20">
        <div className="container mx-auto">
          <div className="mb-8 flex flex-wrap gap-2">
            {workshopCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.96] ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card text-secondary-foreground hover:bg-accent"
                }`}
              >
                {cat}
                {cat !== "All" && (
                  <span className="ml-1.5 text-xs opacity-70">({categoryCounts[cat as keyof typeof categoryCounts] ?? 0})</span>
                )}
              </button>
            ))}
          </div>

          <p className="mb-6 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "workshop" : "workshops"} available
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <motion.div ref={gridRef} initial="hidden" animate="visible" transition={{ staggerChildren: 0.05 }} className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((ws, i) => (
                <WorkshopCard key={ws.id} ws={ws} index={i} />
              ))}
            </motion.div>
          )}
        </div>
      </section>

      {/* Custom quote CTA */}
      <section id="custom-quote" className="bg-background py-16 md:py-24">
        <div className="container mx-auto">
          <div className="mx-auto max-w-2xl rounded-2xl bg-primary px-8 py-14 text-center text-primary-foreground shadow-xl shadow-primary/20 md:px-14">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-foreground/15">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="mb-3 font-serif text-2xl leading-tight md:text-3xl">Need a custom workshop for your team?</h2>
            <p className="mx-auto mb-8 max-w-md text-base leading-relaxed opacity-90">
              We tailor content, duration, and delivery to match your organization&apos;s goals, culture, and industry. Get a custom quote in 24 hours.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button variant="hero-outline" size="xl"
                className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary"
                onClick={() => setQuoteOpen(true)}>
                Request Custom Quote
              </Button>
              <a href="tel:+919987707611" className="text-sm font-medium opacity-80 transition-opacity hover:opacity-100">or call +91 99877 07611</a>
            </div>

            <div className="mt-10 grid gap-4 border-t border-primary-foreground/20 pt-8 text-left sm:grid-cols-3">
              {[
                { title: "Annual Plan", desc: "₹14,999/yr — 12 workshops at 15% off", cta: "Save 15%" },
                { title: "Recording Add-on", desc: "₹2,999/session — get a replay for absent employees", cta: "+₹2,999" },
                { title: "Certification", desc: "₹999/attendee — branded wellness certificates", cta: "+₹999" },
              ].map((addon) => (
                <div key={addon.title} className="rounded-xl bg-primary-foreground/10 p-4">
                  <p className="mb-1 text-sm font-semibold">{addon.title}</p>
                  <p className="mb-2 text-xs opacity-80">{addon.desc}</p>
                  <span className="rounded-full bg-primary-foreground/15 px-2.5 py-0.5 text-xs font-semibold">{addon.cta}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Clientele */}
      <section className="bg-secondary py-10">
        <div className="container mx-auto text-center">
          <p className="mb-6 text-sm font-semibold uppercase tracking-widest text-muted-foreground">Trusted by leading organizations</p>
          <div className="flex flex-wrap items-center justify-center gap-10 opacity-50 grayscale">
            {["Zeal", "BluMoon", "Eco Solar", "PrimeTech", "Ravid"].map((c) => (
              <span key={c} className="text-lg font-bold tracking-wide">{c}</span>
            ))}
          </div>
        </div>
      </section>

      <Footer />
      <WorkshopQuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />
    </div>
  );
};

export default Workshops;

