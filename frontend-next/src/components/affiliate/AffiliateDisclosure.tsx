import Link from "next/link";

const DISCLOSURE_TEXT = "Some product links are affiliate links.";
const COMPACT_DISCLOSURE_TEXT = "Affiliate link.";

export function AffiliateDisclosure({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
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
