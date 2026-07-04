const fs = require("fs");
const path = require("path");
const axios = require("axios");

const OUTPUT_DIR = path.join(__dirname, "..", "uploads", "generated", "campaigns");
const DEFAULT_SERVER_URL = "http://localhost:5000";
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

function trimText(value) {
  return String(value || "").trim();
}

function normalizeWhitespace(value) {
  return trimText(value).replace(/\s+/g, " ");
}

function formatPrice(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function slugify(value) {
  return trimText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "campaign";
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function getSharp() {
  try {
    // Lazy-load to keep server booting even if the package is not installed yet.
    return require("sharp");
  } catch (_error) {
    throw new Error('Image rendering requires the "sharp" package. Run "npm install sharp" inside server-final/server.');
  }
}

function getServerBaseUrl() {
  return String(
    process.env.PUBLIC_MEDIA_BASE_URL
    || process.env.SERVER_URL
    || DEFAULT_SERVER_URL
  ).replace(/\/+$/, "");
}

function resolvePublicUrl(value) {
  const raw = trimText(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${getServerBaseUrl()}${raw}`;
  return `${getServerBaseUrl()}/${raw.replace(/^\/+/, "")}`;
}

function resolveLocalPath(value) {
  const raw = trimText(value);
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const clean = raw.replace(/^\/+/, "");
  return path.join(__dirname, "..", clean);
}

async function readImageBuffer(source) {
  const localPath = resolveLocalPath(source);
  if (localPath && fs.existsSync(localPath)) {
    return fs.promises.readFile(localPath);
  }

  const publicUrl = resolvePublicUrl(source);
  if (!publicUrl) throw new Error("No image URL available for creative generation");

  const response = await axios.get(publicUrl, {
    responseType: "arraybuffer",
    timeout: 20000,
    maxContentLength: 25 * 1024 * 1024,
  });
  return Buffer.from(response.data);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapHeadline(value, maxLength = 24) {
  const words = normalizeWhitespace(value).split(" ").filter(Boolean);
  if (!words.length) return ["Pink Paisa Pick"];
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength || !current) {
      current = candidate;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function buildHeadline(brief, strategy) {
  const firstHook = Array.isArray(strategy?.hooks) ? strategy.hooks.find(Boolean) : null;
  const cleaned = trimText(firstHook || brief?.title || "Pink Paisa Pick")
    .replace(/\.$/, "")
    .replace(/^A softer way to /i, "")
    .replace(/^Explore /i, "");
  return cleaned || brief?.title || "Pink Paisa Pick";
}

function buildSupportingLine(brief) {
  if (brief?.is_affiliate) {
    if (brief?.pricing?.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)) {
      return `Partner-listed from ${formatPrice(brief.pricing.sale_price)}`;
    }
    return `Partner-listed at ${formatPrice(brief?.pricing?.price || 0)}`;
  }
  if (brief?.pricing?.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)) {
    return `Now at ${formatPrice(brief.pricing.sale_price)} instead of ${formatPrice(brief.pricing.price)}`;
  }
  return `Available now at ${formatPrice(brief?.pricing?.price || 0)}`;
}

function chooseCtaText(brief) {
  if (brief?.is_affiliate) return "View Partner Pick";
  const hasOffer = brief?.pricing?.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price);
  if (hasOffer) return "Buy Now";
  if (Number(brief?.constraints?.stock_quantity || 0) <= 10) return "Limited Stock";
  return "Shop Now";
}

function chooseContentType(brief) {
  const configured = String(process.env.MARKETING_DEFAULT_CONTENT_TYPE || "").trim().toLowerCase();
  if (configured === "carousel") return "carousel";
  const carouselEnabled = String(process.env.MARKETING_ENABLE_CAROUSEL || "true") !== "false";
  if (carouselEnabled && Array.isArray(brief?.images) && brief.images.length >= 2) return "carousel";
  return "single_image";
}

function pickFeatureBullets(brief) {
  const bullets = [];
  if (brief?.descriptions?.short) bullets.push(brief.descriptions.short);
  if (brief?.subcategory && brief.subcategory !== "Uncategorized") bullets.push(`${brief.subcategory} focused pick`);
  if (brief?.is_affiliate) bullets.push("Partner affiliate pick");
  else if (brief?.constraints?.returnable) bullets.push(`Easy returns in ${Number(brief.constraints.return_window_days || 7)} days`);
  if (Array.isArray(brief?.tags)) {
    brief.tags.filter(Boolean).slice(0, 2).forEach((tag) => bullets.push(tag));
  }
  return bullets.map((entry) => normalizeWhitespace(entry)).filter(Boolean).slice(0, 3);
}

function buildBackgroundSvg({ headlineLines, subtitle, ctaText, categoryLabel, priceLabel, footerLabel }) {
  const headlineSvg = headlineLines.map((line, index) => (
    `<text x="84" y="${150 + (index * 88)}" fill="#1D1020" font-size="72" font-weight="700" font-family="'Georgia','Times New Roman',serif">${escapeXml(line)}</text>`
  )).join("");

  return Buffer.from(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFF6F8" />
          <stop offset="45%" stop-color="#F8DCE5" />
          <stop offset="100%" stop-color="#F4C1D2" />
        </linearGradient>
        <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98" />
          <stop offset="100%" stop-color="#FFF0F4" stop-opacity="0.95" />
        </linearGradient>
      </defs>

      <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" rx="0" fill="url(#bg)" />
      <circle cx="930" cy="180" r="180" fill="#FFFFFF" fill-opacity="0.35" />
      <circle cx="1010" cy="1060" r="220" fill="#FFFFFF" fill-opacity="0.22" />
      <path d="M0 1060 C240 980 340 1180 560 1100 C720 1040 860 880 1080 980 L1080 1350 L0 1350 Z" fill="#F4A6BF" fill-opacity="0.24" />

      <rect x="78" y="72" width="250" height="54" rx="27" fill="#FFFFFF" fill-opacity="0.86" />
      <text x="105" y="108" fill="#B54777" font-size="26" font-weight="600" font-family="'Arial','Helvetica',sans-serif">${escapeXml(categoryLabel)}</text>

      ${headlineSvg}

      <text x="84" y="404" fill="#6B4B57" font-size="34" font-weight="500" font-family="'Arial','Helvetica',sans-serif">${escapeXml(subtitle)}</text>

      <rect x="84" y="470" width="912" height="610" rx="44" fill="url(#card)" />
      <rect x="84" y="470" width="912" height="610" rx="44" fill="#FFFFFF" fill-opacity="0.55" />

      <rect x="84" y="1110" width="300" height="92" rx="46" fill="#B54777" />
      <text x="142" y="1168" fill="#FFFFFF" font-size="38" font-weight="700" font-family="'Arial','Helvetica',sans-serif">${escapeXml(ctaText)}</text>

      <rect x="736" y="1110" width="260" height="92" rx="46" fill="#FFFFFF" fill-opacity="0.92" />
      <text x="772" y="1168" fill="#B54777" font-size="34" font-weight="700" font-family="'Arial','Helvetica',sans-serif">${escapeXml(priceLabel)}</text>

      <text x="84" y="1275" fill="#7A5D68" font-size="28" font-weight="500" font-family="'Arial','Helvetica',sans-serif">${escapeXml(footerLabel)}</text>
    </svg>
  `);
}

function buildFeatureSlideSvg({ headline, bullets, footerLabel }) {
  const bulletLines = bullets.map((line, index) => (
    `<g transform="translate(84, ${300 + (index * 160)})">
      <circle cx="18" cy="18" r="18" fill="#B54777" />
      <text x="54" y="28" fill="#1D1020" font-size="38" font-weight="600" font-family="'Arial','Helvetica',sans-serif">${escapeXml(line)}</text>
    </g>`
  )).join("");

  return Buffer.from(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFF7F8" />
          <stop offset="100%" stop-color="#F7D4E0" />
        </linearGradient>
      </defs>
      <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#bg)" />
      <rect x="64" y="64" width="952" height="1222" rx="52" fill="#FFFFFF" fill-opacity="0.9" />
      <text x="84" y="170" fill="#B54777" font-size="30" font-weight="700" font-family="'Arial','Helvetica',sans-serif">Why it stands out</text>
      <text x="84" y="248" fill="#1D1020" font-size="68" font-weight="700" font-family="'Georgia','Times New Roman',serif">${escapeXml(headline)}</text>
      ${bulletLines}
      <rect x="84" y="1110" width="912" height="96" rx="48" fill="#1D1020" />
      <text x="140" y="1170" fill="#FFFFFF" font-size="34" font-weight="600" font-family="'Arial','Helvetica',sans-serif">${escapeXml(footerLabel)}</text>
    </svg>
  `);
}

function buildClosingSlideSvg({ ctaText, priceLabel, footerLabel }) {
  return Buffer.from(`
    <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#B54777" />
          <stop offset="100%" stop-color="#E684A6" />
        </linearGradient>
      </defs>
      <rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="url(#bg)" />
      <circle cx="180" cy="180" r="140" fill="#FFFFFF" fill-opacity="0.16" />
      <circle cx="910" cy="1080" r="200" fill="#FFFFFF" fill-opacity="0.18" />
      <text x="84" y="230" fill="#FFFFFF" font-size="38" font-weight="600" font-family="'Arial','Helvetica',sans-serif">Pink Paisa</text>
      <text x="84" y="380" fill="#FFFFFF" font-size="110" font-weight="700" font-family="'Georgia','Times New Roman',serif">${escapeXml(ctaText)}</text>
      <text x="84" y="500" fill="#FFE8F0" font-size="42" font-weight="600" font-family="'Arial','Helvetica',sans-serif">${escapeXml(priceLabel)}</text>
      <rect x="84" y="980" width="540" height="110" rx="55" fill="#FFFFFF" />
      <text x="152" y="1050" fill="#B54777" font-size="44" font-weight="700" font-family="'Arial','Helvetica',sans-serif">Tap to shop</text>
      <text x="84" y="1210" fill="#FFE8F0" font-size="30" font-weight="500" font-family="'Arial','Helvetica',sans-serif">${escapeXml(footerLabel)}</text>
    </svg>
  `);
}

async function renderBaseSlide({ overlaySvg, productBuffer, productWidth = 700, productHeight = 700, productTop = 520, productLeft = 190 }) {
  const sharp = getSharp();
  const resizedProduct = await sharp(productBuffer)
    .resize(productWidth, productHeight, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: "#FFF7FA",
    },
  })
    .composite([
      { input: overlaySvg, top: 0, left: 0 },
      { input: resizedProduct, top: productTop, left: productLeft },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

async function writeOutput(fileName, buffer) {
  ensureOutputDir();
  const filePath = path.join(OUTPUT_DIR, fileName);
  await fs.promises.writeFile(filePath, buffer);
  return {
    file_path: filePath,
    public_url: `${getServerBaseUrl()}/uploads/generated/campaigns/${fileName}`,
  };
}

async function renderSingleImage({ campaignId, brief, strategy, productBuffer }) {
  const headline = buildHeadline(brief, strategy);
  const ctaText = chooseCtaText(brief);
  const supportingLine = buildSupportingLine(brief);
  const headlineLines = wrapHeadline(headline);
  const priceLabel = brief?.pricing?.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)
    ? formatPrice(brief.pricing.sale_price)
    : formatPrice(brief?.pricing?.price || 0);

  const overlaySvg = buildBackgroundSvg({
    headlineLines,
    subtitle: supportingLine,
    ctaText,
    categoryLabel: brief?.category || "Pink Paisa",
    priceLabel,
    footerLabel: "Discover more on Pink Paisa",
  });

  const imageBuffer = await renderBaseSlide({
    overlaySvg,
    productBuffer,
  });

  const output = await writeOutput(`${slugify(campaignId)}-hero.jpg`, imageBuffer);
  return {
    content_type: "single_image",
    cta_text: ctaText,
    primary_asset_url: output.public_url,
    asset_urls: [output.public_url],
    creative_json: {
      layout: "single_image_offer_card",
      headline,
      supporting_line: supportingLine,
      price_label: priceLabel,
      cta_text: ctaText,
      generated_at: new Date().toISOString(),
    },
  };
}

async function renderCarousel({ campaignId, brief, strategy, productBuffer }) {
  const headline = buildHeadline(brief, strategy);
  const ctaText = chooseCtaText(brief);
  const priceLabel = brief?.pricing?.sale_price != null && Number(brief.pricing.sale_price) < Number(brief.pricing.price)
    ? formatPrice(brief.pricing.sale_price)
    : formatPrice(brief?.pricing?.price || 0);
  const supportingLine = buildSupportingLine(brief);
  const headlineLines = wrapHeadline(headline);
  const bullets = pickFeatureBullets(brief);

  const slide1 = await renderBaseSlide({
    overlaySvg: buildBackgroundSvg({
      headlineLines,
      subtitle: supportingLine,
      ctaText,
      categoryLabel: brief?.category || "Pink Paisa",
      priceLabel,
      footerLabel: "Swipe for details",
    }),
    productBuffer,
  });

  const slide2 = await renderBaseSlide({
    overlaySvg: buildFeatureSlideSvg({
      headline: trimText(brief?.title || "Pink Paisa Pick"),
      bullets: bullets.length ? bullets : ["Chosen for an everyday routine", "Made to feel premium without being loud", "Ready to shop on Pink Paisa"],
      footerLabel: "Smart, warm, and women-first picks",
    }),
    productBuffer,
    productWidth: 420,
    productHeight: 420,
    productTop: 760,
    productLeft: 580,
  });

  const slide3 = await renderBaseSlide({
    overlaySvg: buildClosingSlideSvg({
      ctaText,
      priceLabel,
      footerLabel: "Open Pink Paisa and shop the full product page",
    }),
    productBuffer,
    productWidth: 520,
    productHeight: 520,
    productTop: 520,
    productLeft: 500,
  });

  const outputs = await Promise.all([
    writeOutput(`${slugify(campaignId)}-carousel-1.jpg`, slide1),
    writeOutput(`${slugify(campaignId)}-carousel-2.jpg`, slide2),
    writeOutput(`${slugify(campaignId)}-carousel-3.jpg`, slide3),
  ]);

  return {
    content_type: "carousel",
    cta_text: ctaText,
    primary_asset_url: outputs[0].public_url,
    asset_urls: outputs.map((item) => item.public_url),
    creative_json: {
      layout: "three_panel_carousel",
      headline,
      supporting_line: supportingLine,
      price_label: priceLabel,
      cta_text: ctaText,
      slides: [
        { type: "hero", url: outputs[0].public_url },
        { type: "features", url: outputs[1].public_url, bullets },
        { type: "closing", url: outputs[2].public_url },
      ],
      generated_at: new Date().toISOString(),
    },
  };
}

async function generateInstagramCreative(run, brief, strategy) {
  if (!brief) throw new Error("Product brief missing for creative generation");

  const primaryImage = Array.isArray(brief.images) ? brief.images.find(Boolean) : null;
  if (!primaryImage) throw new Error("At least one product image is required to generate Instagram creative");

  const productBuffer = await readImageBuffer(primaryImage);
  const contentType = chooseContentType(brief, strategy);

  if (contentType === "carousel") {
    return renderCarousel({
      campaignId: run.campaign_id,
      brief,
      strategy,
      productBuffer,
    });
  }

  return renderSingleImage({
    campaignId: run.campaign_id,
    brief,
    strategy,
    productBuffer,
  });
}

module.exports = {
  chooseCtaText,
  generateInstagramCreative,
  resolvePublicUrl,
};
