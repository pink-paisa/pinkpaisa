import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import GoogleTranslate from "@/components/GoogleTranslate";
import pinkPaisaLogo from "@/assets/pink-paisa-logo.png";
import { ShoppingCart, Menu, X, Heart, UserRound, ChevronDown } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useCustomerAuth } from "@/contexts/CustomerAuthContext";
import { AnimatePresence, motion } from "framer-motion";
import { useProductTaxonomy } from "@/hooks/useProductTaxonomy";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { financialCalculatorGroups } from "@/data/financialCalculators";
import { useWishlist } from "@/hooks/useWishlist";

const navLinks = [
  { label: "Featured Products", href: "/#products", isHash: true },
  { label: "Pink Pages", href: "/pink-pages" },
  { label: "Workshops", href: "/workshops" },
  { label: "Predictions", href: "/predictions" },
  { label: "Quiz", href: "/quiz" },
  { label: "Blog", href: "/blogs" },
];

const Navbar = () => {
  const router = useRouter();
  const { totalItems, setIsCartOpen } = useCart();
  const { user } = useCustomerAuth();
  const { wishlistCount } = useWishlist();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [megaOpen, setMegaOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const { data: taxonomy } = useProductTaxonomy();

  const visibleTaxonomy = useMemo(
    () => (taxonomy ?? []).filter((category) => category.slug !== "uncategorized" && category.is_active),
    [taxonomy],
  );

  const currentPath = router.asPath.split("?")[0].split("#")[0];
  const isFinancialRoute = currentPath.startsWith("/financial-calculator");

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
          <img src={pinkPaisaLogo.src} alt="Pink Paisa" className="h-7" />
        </Link>

        <nav className="hidden items-center gap-4 lg:flex">
          {navLinks.slice(0, 1).map((link) => (
            <Link key={link.label} href={link.href} className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}

          <div className="relative" onMouseEnter={() => setMegaOpen(true)} onMouseLeave={() => setMegaOpen(false)}>
            <Link href="/products" className="inline-flex items-center gap-1 py-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              Wellness Products <ChevronDown className="h-3.5 w-3.5" />
            </Link>
            <AnimatePresence>
              {megaOpen && visibleTaxonomy.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-1/2 top-[calc(100%-8px)] z-50 w-[min(90vw,900px)] -translate-x-1/2 pt-4"
                >
                  <div className="rounded-3xl border border-border bg-background p-6 shadow-2xl">
                    <div className="grid gap-6 md:grid-cols-3 xl:grid-cols-4">
                      {visibleTaxonomy.map((category) => (
                        <div key={category.id} className="min-w-0">
                          <Link
                            href={`/products?category=${encodeURIComponent(category.slug)}`}
                            className="block border-b border-border/60 pb-2 text-sm font-semibold text-foreground hover:text-primary"
                          >
                            {category.name}
                          </Link>
                          <div className="mt-3 space-y-2">
                            {category.subcategories.map((subcategory) => (
                              <Link
                                key={subcategory.id}
                                href={`/products?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(subcategory.slug)}`}
                                className="block text-sm text-muted-foreground transition-colors hover:text-foreground"
                              >
                                {subcategory.name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="relative" onMouseEnter={() => setFinancialOpen(true)} onMouseLeave={() => setFinancialOpen(false)}>
            <Link
              href="/financial-calculator"
              className={`inline-flex items-center gap-1 py-3 text-[13px] font-medium transition-colors ${isFinancialRoute ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Financial Calculator <ChevronDown className="h-3.5 w-3.5" />
            </Link>
            <AnimatePresence>
              {financialOpen && financialCalculatorGroups.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="absolute left-1/2 top-[calc(100%-8px)] z-50 w-[min(90vw,760px)] -translate-x-1/2 pt-4"
                >
                  <div className="rounded-3xl border border-border bg-background p-6 shadow-2xl">
                    <div className="grid gap-6 md:grid-cols-2">
                      {financialCalculatorGroups.map((group) => (
                        <div key={group.title} className="min-w-0">
                          <Link
                            href="/financial-calculator"
                            className="block border-b border-border/60 pb-2 text-sm font-semibold text-foreground hover:text-primary"
                          >
                            {group.title}
                          </Link>
                          <div className="mt-3 space-y-2">
                            {group.items.map((item) => (
                              <Link
                                key={item.slug}
                                href={`/financial-calculator/${item.slug}`}
                                className="block text-sm text-muted-foreground transition-colors hover:text-foreground"
                              >
                                {item.title}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {navLinks.slice(1).map((link) => (
            <Link key={link.label} href={link.href} className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <GoogleTranslate />
          <Link href="/account/wishlist" className="relative hidden rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex" aria-label="Wishlist">
            <Heart className="h-5 w-5" />
            {wishlistCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {wishlistCount > 9 ? "9+" : wishlistCount}
              </span>
            ) : null}
          </Link>
          <Link href={user ? "/account" : "/account/auth"} className="hidden rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:inline-flex" aria-label="Account">
            <UserRound className="h-5 w-5" />
          </Link>
          <button onClick={() => setIsCartOpen(true)} className="relative rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open cart">
            <ShoppingCart className="h-5 w-5" />
            {totalItems > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{totalItems > 9 ? "9+" : totalItems}</span> : null}
          </button>
          <Link href="/products" className="hidden rounded-lg bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-[0.97] sm:inline-flex">
            Shop Now
          </Link>
          <button
            onClick={() => setMobileOpen((value) => !value)}
            className="rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="pinkpaisa-mobile-nav"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <motion.nav
            id="pinkpaisa-mobile-nav"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain border-t border-border/50 bg-background lg:hidden"
          >
            <div className="container mx-auto flex flex-col gap-1 py-4">
              <Link href="/#products" onClick={() => setMobileOpen(false)} className="rounded-lg px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                Featured Products
              </Link>
              <Accordion type="single" collapsible className="rounded-lg border border-border/60 px-4">
                <AccordionItem value="wellness" className="border-none">
                  <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">Wellness Products</AccordionTrigger>
                  <AccordionContent>
                    <Link href="/products" onClick={() => setMobileOpen(false)} className="mb-3 block text-sm font-medium text-primary">
                      View all wellness products
                    </Link>
                    <div className="space-y-4">
                      {visibleTaxonomy.map((category) => (
                        <div key={category.id}>
                          <Link href={`/products?category=${encodeURIComponent(category.slug)}`} onClick={() => setMobileOpen(false)} className="block text-sm font-semibold text-foreground">
                            {category.name}
                          </Link>
                          <div className="mt-2 space-y-2 pl-3">
                            {category.subcategories.map((subcategory) => (
                              <Link
                                key={subcategory.id}
                                href={`/products?category=${encodeURIComponent(category.slug)}&subcategory=${encodeURIComponent(subcategory.slug)}`}
                                onClick={() => setMobileOpen(false)}
                                className="block text-sm text-muted-foreground"
                              >
                                {subcategory.name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="financial-calculator" className="border-none">
                  <AccordionTrigger className="py-3 text-sm font-medium text-foreground hover:no-underline">Financial Calculator</AccordionTrigger>
                  <AccordionContent>
                    <Link href="/financial-calculator" onClick={() => setMobileOpen(false)} className="mb-3 block text-sm font-medium text-primary">
                      View all financial calculators
                    </Link>
                    <div className="space-y-4 pl-1">
                      {financialCalculatorGroups.map((group) => (
                        <div key={group.title}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{group.title}</p>
                          <div className="space-y-2">
                            {group.items.map((item) => (
                              <Link
                                key={item.slug}
                                href={`/financial-calculator/${item.slug}`}
                                onClick={() => setMobileOpen(false)}
                                className="block text-sm text-muted-foreground"
                              >
                                {item.title}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              {navLinks.slice(1).map((link) => (
                <Link key={link.label} href={link.href} onClick={() => setMobileOpen(false)} className="rounded-lg px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                  {link.label}
                </Link>
              ))}
              <Link href={user ? "/account" : "/account/auth"} onClick={() => setMobileOpen(false)} className="rounded-lg px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                My Account
              </Link>
              <Link href="/account/wishlist" onClick={() => setMobileOpen(false)} className="rounded-lg px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                Wishlist {wishlistCount > 0 ? `(${wishlistCount})` : ""}
              </Link>
              <Link href="/vendor/signup" onClick={() => setMobileOpen(false)} className="mt-2 rounded-lg border border-border bg-white px-4 py-3 text-center text-sm font-semibold text-foreground shadow-sm transition-all hover:bg-accent">
                Vendor Sign Up
              </Link>
              <Link href="/products" onClick={() => setMobileOpen(false)} className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground shadow-sm transition-all">
                Shop Now
              </Link>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
};

export default Navbar;
