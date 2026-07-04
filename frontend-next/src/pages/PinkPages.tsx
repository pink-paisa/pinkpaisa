import { useState, useMemo } from "react";
import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Search, Phone, Mail, Star, BadgeCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePinkPagesCategories, usePinkPagesListings, type PinkPagesListing } from "@/hooks/usePinkPages";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const ListingCard = ({ biz, index }: { biz: PinkPagesListing; index: number }) => (
  <motion.div
    variants={fadeUp}
    transition={{ duration: 0.5, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
    className={`group relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-shadow duration-300 hover:shadow-lg ${
      biz.featured
        ? "border-primary/30 ring-1 ring-primary/10"
        : "border-border"
    }`}
  >
    {biz.featured && (
      <div className="absolute -top-3 right-4 flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/20">
        <Star className="h-3 w-3" />
        Featured
      </div>
    )}

    <div className="mb-3 flex items-center gap-3">
      {biz.logo ? (
        <img src={biz.logo} alt={biz.business_name} className="h-11 w-11 rounded-xl object-cover" />
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-lg font-bold text-primary">
          {biz.business_name.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate font-semibold leading-tight">{biz.business_name}</h3>
          {biz.verified && <BadgeCheck className="h-4 w-4 flex-shrink-0 text-primary" />}
        </div>
        <p className="text-xs font-medium text-primary">{biz.category_name}</p>
      </div>
    </div>

    {biz.short_description && (
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground line-clamp-2">
        {biz.short_description}
      </p>
    )}

    <div className="mt-auto flex gap-2 pt-2">
      <a
        href={`tel:${biz.phone}`}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent active:scale-[0.97]"
      >
        <Phone className="h-3.5 w-3.5" /> Call
      </a>
      <a
        href={`mailto:${biz.email}`}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-secondary py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent active:scale-[0.97]"
      >
        <Mail className="h-3.5 w-3.5" /> Email
      </a>
    </div>
  </motion.div>
);

const PinkPages = () => {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.05 });

  const { data: categories = [] } = usePinkPagesCategories(true);
  const { data: listings = [], isLoading } = usePinkPagesListings({ activeOnly: true, verifiedOnly: true });

  const categoryNames = useMemo(() => ["All", ...categories.map((c) => c.name)], [categories]);

  const filtered = useMemo(() => {
    let list = listings;
    if (activeCategory !== "All") {
      list = list.filter((b) => b.category_name === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.business_name.toLowerCase().includes(q) ||
          b.category_name?.toLowerCase().includes(q) ||
          b.short_description?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  }, [search, activeCategory, listings]);

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero */}
      <section className="bg-rose-soft py-16 md:py-24">
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
          >
            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary"
            >
              Pink Pages Directory
            </motion.p>
            <motion.h1
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="mb-4 max-w-xl font-serif text-3xl leading-tight md:text-4xl lg:text-5xl"
            >
              Discover women-led businesses
            </motion.h1>
            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="mb-8 max-w-md text-lg text-muted-foreground"
            >
              A curated network directory to support and connect with
              enterprising women across India.
            </motion.p>

            {/* Search */}
            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex max-w-lg items-center gap-3"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search businesses..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-12 rounded-xl border-border bg-card pl-10 text-base shadow-sm"
                />
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Categories + Grid */}
      <section className="bg-background py-12 md:py-16">
        <div className="container mx-auto">
          {/* Category pills */}
          <div className="mb-8 flex flex-wrap gap-2">
            {categoryNames.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.96] ${
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-secondary text-secondary-foreground hover:bg-accent"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Results count */}
          <p className="mb-6 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "business" : "businesses"} found
          </p>

          {/* Grid */}
          <motion.div
            ref={ref}
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            transition={{ staggerChildren: 0.04 }}
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {filtered.map((biz, i) => (
              <ListingCard key={biz.id} biz={biz} index={i} />
            ))}
          </motion.div>

          {isLoading && (
            <div className="py-20 text-center">
              <p className="text-lg font-medium text-muted-foreground">Loading businesses...</p>
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-lg font-medium text-muted-foreground">
                No businesses match your search.
              </p>
              <button
                onClick={() => {
                  setSearch("");
                  setActiveCategory("All");
                }}
                className="mt-3 text-sm font-medium text-primary hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Register CTA */}
      <section className="bg-rose-soft py-16 md:py-20">
        <div className="container mx-auto">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="mb-4 font-serif text-2xl leading-tight md:text-3xl">
              List your business on Pink Pages
            </h2>
            <p className="mb-6 text-muted-foreground">
              Join a community of enterprising women. Register for free or go
              premium for featured placement and verified badges.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button variant="hero" size="xl" asChild>
                <Link href="/pink-pages/submit?plan=free">Register Free</Link>
              </Button>
              <Button variant="hero-outline" size="xl" asChild>
                <Link href="/pink-pages/submit?plan=premium">Go Premium - Rs 999/yr</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Premium includes: featured listing, verified badge, priority in
              search, and analytics dashboard.
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default PinkPages;

