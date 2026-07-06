import Link from "next/link";

const DISCLOSURE_TEXT = "As an Amazon Associate I earn from qualifying purchases.";
const COMPACT_DISCLOSURE_TEXT = DISCLOSURE_TEXT;

export function AffiliateDisclosure({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-[11px] leading-4 text-muted-foreground">
        {COMPACT_DISCLOSURE_TEXT}{" "}
        <Link href="/affiliate-disclosure" className="font-medium text-primary hover:underline">
          Details
        </Link>
      </p>
    );
  }

  return (
    <p className="text-sm leading-6 text-muted-foreground">
      Affiliate notice: {DISCLOSURE_TEXT}{" "}
      <Link href="/affiliate-disclosure" className="font-medium text-primary hover:underline">
        Details
      </Link>
    </p>
  );
}

export { COMPACT_DISCLOSURE_TEXT, DISCLOSURE_TEXT };
