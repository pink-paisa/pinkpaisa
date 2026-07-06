import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AffiliateDisclosure } from "@/components/affiliate/AffiliateDisclosure";
import { getAffiliateCtaExperiment, trackAffiliateEvent, type AffiliateTrackableProduct } from "@/lib/affiliateTracking";

type AffiliateCtaProps = {
  product: AffiliateTrackableProduct & {
    affiliate_url?: string | null;
    affiliate_compliance_status?: string | null;
  };
  label?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "secondary" | "outline" | "product";
  className?: string;
  showDisclosure?: boolean;
};

export function AffiliateCta({
  product,
  label,
  size = "default",
  variant = "default",
  className,
  showDisclosure = true,
}: AffiliateCtaProps) {
  const [experimentVariant, setExperimentVariant] = useState("check_price_on_amazon");
  const href = product.affiliate_url || "";
  const disabled = !href || product.affiliate_compliance_status !== "compliant";
  const resolvedLabel = label || (experimentVariant === "view_on_amazon" ? "View on Amazon" : "Check price on Amazon");

  useEffect(() => {
    setExperimentVariant(getAffiliateCtaExperiment().experiment_variant);
  }, []);

  const handleClick = () => {
    if (disabled) return;
    trackAffiliateEvent(product, "cta_click");
    trackAffiliateEvent(product, "outbound_click");
  };

  return (
    <div className="w-full space-y-2">
      {disabled ? (
        <Button type="button" size={size} variant="secondary" className={className} disabled>
          Amazon link under review
        </Button>
      ) : (
        <Button asChild size={size} variant={variant} className={className}>
          <a
            href={href}
            target="_blank"
            rel="sponsored noopener noreferrer nofollow"
            onClick={handleClick}
          >
            <ExternalLink className="h-4 w-4" />
            {resolvedLabel}
          </a>
        </Button>
      )}
      {showDisclosure ? <AffiliateDisclosure compact /> : null}
    </div>
  );
}
