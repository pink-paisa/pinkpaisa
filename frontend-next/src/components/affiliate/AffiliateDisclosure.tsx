import Link from "next/link";

const DISCLOSURE_TEXT = "As an Amazon Associate I earn from qualifying purchases.";

export function AffiliateDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <p className={compact ? "text-[11px] leading-4 text-muted-foreground" : "text-sm leading-6 text-muted-foreground"}>
      {DISCLOSURE_TEXT}{" "}
      <Link href="/affiliate-disclosure" className="font-medium text-primary hover:underline">
        Learn more
      </Link>
    </p>
  );
}

export { DISCLOSURE_TEXT };
