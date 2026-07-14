import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";

const CampaignCreativePreview = ({
  title,
  assetUrls,
  contentType,
  ctaText,
  trackedUrl,
  onPreview,
}: {
  title: string;
  assetUrls: string[];
  contentType: string | null | undefined;
  ctaText: string | null | undefined;
  trackedUrl: string | null | undefined;
  onPreview?: (index: number) => void;
}) => {
  const urls = Array.isArray(assetUrls) ? assetUrls.filter(Boolean) : [];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [urls.join("|")]);

  const selectedUrl = urls[Math.min(activeIndex, Math.max(urls.length - 1, 0))] || null;

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Instagram creative</p>
          {contentType ? <Badge variant="outline" className="rounded-full capitalize">{contentType.replace(/_/g, " ")}</Badge> : null}
          {ctaText ? <Badge className="rounded-full bg-[#B54777]">{ctaText}</Badge> : null}
          {urls.length > 1 ? <p className="text-xs text-muted-foreground">{urls.length} slides</p> : null}
        </div>
        {selectedUrl && onPreview ? (
          <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={() => onPreview(activeIndex)}>
            <Maximize2 className="mr-2 h-4 w-4" /> Preview post
          </Button>
        ) : null}
      </div>

      {selectedUrl ? (
        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => onPreview?.(activeIndex)}
            className="group relative block w-full overflow-hidden rounded-lg border border-border/70 bg-[#fff8fa] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`Preview ${title} creative slide ${activeIndex + 1}`}
            disabled={!onPreview}
          >
            <img src={selectedUrl} alt={`${title} creative ${activeIndex + 1}`} className="aspect-[4/5] w-full max-h-[34rem] object-cover object-center" />
            {onPreview ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:bg-black/25 group-focus-visible:opacity-100">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70" aria-hidden="true">
                  <Maximize2 className="h-5 w-5" />
                </span>
              </span>
            ) : null}
          </button>

          {urls.length > 1 ? (
            <div className="-mx-1 overflow-x-auto pb-1">
              <div className="flex gap-3 px-1">
                {urls.map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={`w-28 shrink-0 overflow-hidden rounded-2xl border bg-background text-left transition-all ${
                      index === activeIndex ? "border-[#B54777] shadow-md shadow-[#B54777]/20 ring-2 ring-[#B54777]/20" : "border-border/70 hover:border-[#B54777]/40"
                    }`}
                    aria-label={`Show slide ${index + 1}`}
                    aria-pressed={index === activeIndex}
                  >
                    <img src={url} alt={`${title} thumbnail ${index + 1}`} className="aspect-[4/5] w-full object-cover" />
                    <div className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">Slide {index + 1}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No generated creative assets yet.
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-[#fff8fa] p-4 text-sm text-[#6b4b57]">
        <p className="font-medium">Tracked destination</p>
        <p className="mt-1 break-all text-xs leading-6">{trackedUrl || "Tracking link will appear after the tracking stage completes."}</p>
      </div>
    </div>
  );
};

export default CampaignCreativePreview;
