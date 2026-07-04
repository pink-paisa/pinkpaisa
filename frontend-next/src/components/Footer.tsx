import pinkPaisaLogo from "@/assets/pink-paisa-logo.png";
import Link from "next/link";

const Footer = () => {
  return (
    <footer className="border-t border-border bg-secondary py-12">
      <div className="container mx-auto">
        <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
          <div>
            <img src={pinkPaisaLogo.src} alt="Pink Paisa" className="h-7" />
            <p className="mt-1 text-sm text-muted-foreground">
              Wealth | Wellness | Women
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <Link
              href="/vendor/signup"
              className="transition-colors hover:text-foreground"
            >
              Vendor Sign Up
            </Link>
            <Link
              href="/affiliate-disclosure"
              className="transition-colors hover:text-foreground"
            >
              Affiliate Disclosure
            </Link>
            <a
              href="https://pinkpaisa.in"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              pinkpaisa.in
            </a>
            <a
              href="https://instagram.com/pinkpaisa.in"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Instagram
            </a>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">
          As an Amazon Associate I earn from qualifying purchases.
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Copyright {new Date().getFullYear()} Pink Paisa. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
