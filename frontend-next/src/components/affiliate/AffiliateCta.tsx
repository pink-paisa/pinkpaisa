import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AffiliateDisclosure } from "@/components/affiliate/AffiliateDisclosure";
import { buildAffiliateOutboundQuery, getAffiliateCtaExperiment, trackAffiliateEvent, type AffiliateTrackableProduct } from "@/lib/affiliateTracking";
import { API_URL } from "@/lib/api";
import { trackAnalyticsEvent } from "@/lib/analytics";

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
  surface?: "card" | "detail";
};

export function AffiliateCta({
  product,
  label,
  size = "default",
  variant = "default",
  className,
  showDisclosure = true,
  surface = "card",
}: AffiliateCtaProps) {
  const [experimentVariant, setExperimentVariant] = useState("check_price_on_amazon");
  const [outboundQuery, setOutboundQuery] = useState("");
  const outboundBase = product.id ? `${API_URL.replace(/\/$/, "")}/affiliate-events/out/${encodeURIComponent(product.id)}` : "";
  const href = outboundBase ? `${outboundBase}${outboundQuery ? `?${outboundQuery}` : ""}` : "";
  const disabled = !product.affiliate_url || !href || product.affiliate_compliance_status !== "compliant";
  const resolvedLabel = label || (experimentVariant === "view_on_amazon" ? "View on Amazon" : "Check price on Amazon");

  useEffect(() => {
    setExperimentVariant(getAffiliateCtaExperiment().experiment_variant);
    setOutboundQuery(buildAffiliateOutboundQuery());
    if (surface === "card" && !disabled) trackAffiliateEvent(product, "card_impression");
  }, [disabled, product, surface]);

  const handleClick = () => {
    if (disabled) return;
    trackAffiliateEvent(product, "cta_click");
    trackAnalyticsEvent("affiliate_outbound_click", {
      item_id: product.id,
      item_category: product.category || undefined,
      experiment_name: "affiliate_cta_text_v1",
      experiment_variant: experimentVariant,
      measurement_semantics: "retailer_redirect_intent",
    });
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
