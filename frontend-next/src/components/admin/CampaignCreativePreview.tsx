import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Maximize2 } from "lucide-react";

const CampaignCreativePreview = ({
  title,
  referenceImageUrl,
  referenceStatus,
  referenceRightsStatus,
  assetUrls,
  contentType,
  ctaText,
  trackedUrl,
  provider,
  model,
  generatedAt,
  onPreview,
}: {
  title: string;
  referenceImageUrl?: string | null;
  referenceStatus?: string | null;
  referenceRightsStatus?: string | null;
  assetUrls: string[];
  contentType: string | null | undefined;
  ctaText: string | null | undefined;
  trackedUrl: string | null | undefined;
  provider?: string | null;
  model?: string | null;
  generatedAt?: string | null;
  onPreview?: (index: number) => void;
}) => {
  const urls = Array.isArray(assetUrls) ? assetUrls.filter(Boolean) : [];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [urls.join("|")]);

  const selectedUrl = urls[Math.min(activeIndex, Math.max(urls.length - 1, 0))] || null;
  const rightsUnconfirmed = referenceRightsStatus
    && !["admin_confirmed", "owned", "licensed", "api_permitted"].includes(referenceRightsStatus);

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Reference and generated post</p>
          {contentType ? <Badge variant="outline" className="rounded-full capitalize">{contentType.replace(/_/g, " ")}</Badge> : null}
          {ctaText ? <Badge className="rounded-full bg-[#B54777]">{ctaText}</Badge> : null}
        </div>
        {selectedUrl && onPreview ? (
          <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => onPreview(activeIndex)}>
            <Maximize2 className="mr-2 h-4 w-4" /> Preview generated post
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Product reference</p>
            <Badge variant="outline" className="rounded-full capitalize">{referenceStatus || (referenceImageUrl ? "available" : "required")}</Badge>
          </div>
          <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/20">
            {referenceImageUrl ? (
              <img src={referenceImageUrl} alt={`${title} product reference`} className="h-full w-full object-contain" />
            ) : (
              <p className="px-6 text-center text-sm text-rose-700">Product image required.</p>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Generated Instagram post</p>
            {provider || model ? <p className="truncate text-xs text-muted-foreground">{[provider, model].filter(Boolean).join(" / ")}</p> : null}
          </div>
          {selectedUrl ? (
            <button
              type="button"
              onClick={() => onPreview?.(activeIndex)}
              className="group relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-[#fff8fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={`Preview ${title} generated creative`}
              disabled={!onPreview}
            >
              <img src={selectedUrl} alt={`${title} generated creative`} className="h-full w-full object-contain" />
              {onPreview ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:bg-black/25 group-focus-visible:opacity-100">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70" aria-hidden="true">
                    <Maximize2 className="h-5 w-5" />
                  </span>
                </span>
              ) : null}
            </button>
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Generated image will appear after the creative task completes.
            </div>
          )}
        </div>
      </div>

      {urls.length > 1 ? (
        <div className="mt-4 overflow-x-auto pb-1">
          <div className="flex gap-3">
            {urls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`w-24 shrink-0 overflow-hidden rounded-lg border bg-background ${index === activeIndex ? "border-primary ring-2 ring-primary/20" : "border-border/70"}`}
              >
                <img src={url} alt={`${title} historical slide ${index + 1}`} className="aspect-[4/5] w-full object-contain" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {rightsUnconfirmed ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Image usage rights are marked {referenceRightsStatus}. This is an audit warning and does not replace admin review.</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:grid-cols-[1fr,auto]">
        <p className="break-all"><span className="font-medium text-foreground">Tracked destination:</span> {trackedUrl || "Created after compliance."}</p>
        {generatedAt ? <p>Generated {new Date(generatedAt).toLocaleString("en-IN")}</p> : null}
      </div>
    </div>
  );
};

export default CampaignCreativePreview;
