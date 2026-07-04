import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

const CampaignCreativePreview = ({
  title,
  assetUrls,
  contentType,
  ctaText,
  trackedUrl,
}: {
  title: string;
  assetUrls: string[];
  contentType: string | null | undefined;
  ctaText: string | null | undefined;
  trackedUrl: string | null | undefined;
}) => {
  const urls = Array.isArray(assetUrls) ? assetUrls.filter(Boolean) : [];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [urls.join("|")]);

  const selectedUrl = urls[Math.min(activeIndex, Math.max(urls.length - 1, 0))] || null;

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Instagram creative</p>
        {contentType ? <Badge variant="outline" className="rounded-full capitalize">{contentType.replace(/_/g, " ")}</Badge> : null}
        {ctaText ? <Badge className="rounded-full bg-[#B54777]">{ctaText}</Badge> : null}
        {urls.length > 1 ? <p className="text-xs text-muted-foreground">{urls.length} slides</p> : null}
      </div>

      {selectedUrl ? (
        <div className="mt-4 space-y-3">
          <div className="overflow-hidden rounded-[28px] border border-border/70 bg-[#fff8fa]">
            <img src={selectedUrl} alt={`${title} creative ${activeIndex + 1}`} className="aspect-[4/5] w-full max-h-[34rem] object-cover object-center" />
          </div>

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
