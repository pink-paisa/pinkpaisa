import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import { type CampaignCreativeAsset } from "./CampaignCreativePreview";

export type CampaignPostPreview = {
  title: string;
  assetUrls: string[];
  startIndex?: number;
  contentType?: string | null;
  ctaText?: string | null;
  trackedUrl?: string | null;
  creativeAssets?: CampaignCreativeAsset[];
};

type CampaignPostLightboxProps = CampaignPostPreview & {
  open: boolean;
  onClose: () => void;
  onDownloadAsset?: (asset: CampaignCreativeAsset) => void;
  downloadingAssetKey?: string | null;
};

export default function CampaignPostLightbox({
  open,
  onClose,
  title,
  assetUrls,
  startIndex = 0,
  contentType,
  ctaText,
  trackedUrl,
  creativeAssets = [],
  onDownloadAsset,
  downloadingAssetKey = null,
}: CampaignPostLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const urls = useMemo(
    () => Array.from(new Set(assetUrls.map((url) => String(url || "").trim()).filter(Boolean))),
    [assetUrls],
  );
  const description = [
    contentType ? contentType.replace(/_/g, " ") : null,
    ctaText ? `CTA: ${ctaText}` : null,
    trackedUrl ? `Destination: ${trackedUrl}` : null,
  ].filter(Boolean).join(" | ");
  const slides = useMemo(
    () => urls.map((src, index) => ({
      src,
      alt: `${title} Instagram creative ${index + 1}`,
      width: 1080,
      height: 1350,
      title: urls.length > 1 ? `${title} - Slide ${index + 1}` : title,
      description,
    })),
    [description, title, urls],
  );
  const initialIndex = Math.min(Math.max(startIndex, 0), Math.max(slides.length - 1, 0));
  const activeIndex = Math.min(Math.max(currentIndex, 0), Math.max(urls.length - 1, 0));
  const activeUrl = urls[activeIndex] || null;
  const activeAsset = creativeAssets.find((asset) => asset.index === activeIndex || asset.url === activeUrl) || null;

  if (!slides.length) return null;

  return (
    <>
      <Lightbox
        open={open}
        close={onClose}
        index={initialIndex}
        slides={slides}
        plugins={[Captions, Counter, Fullscreen, Zoom]}
        className="campaign-post-lightbox"
        carousel={{ finite: true, imageFit: "contain", padding: "48px", spacing: "24px" }}
        controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
        captions={{ descriptionTextAlign: "center", descriptionMaxLines: 2, showToggle: false }}
        counter={{ separator: " of " }}
        zoom={{ maxZoomPixelRatio: 3, zoomInMultiplier: 2 }}
        animation={{ fade: 180, swipe: 320 }}
        on={{ view: ({ index }) => setCurrentIndex(index) }}
        labels={{
          Close: "Close post preview",
          Next: "Next campaign slide",
          Previous: "Previous campaign slide",
        }}
      />
      {activeAsset?.download_url && onDownloadAsset ? (
        <div className="fixed right-5 top-5 z-[10000]">
          <Button
            type="button"
            variant="secondary"
            className="rounded-xl bg-white/95 shadow-lg"
            onClick={() => onDownloadAsset(activeAsset)}
            disabled={downloadingAssetKey === `${activeAsset.download_url}:${activeAsset.index}`}
          >
            <Download className="mr-2 h-4 w-4" />
            {urls.length > 1 ? `Download slide ${activeIndex + 1}` : "Download image"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
