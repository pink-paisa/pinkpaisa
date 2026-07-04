import Head from "next/head";

type SeoHeadProps = {
  title: string;
  description: string;
  canonicalPath?: string;
  image?: string | null;
  type?: "website" | "article" | "product";
};

const SITE_NAME = "Pink Paisa";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.pinkpaisa.in";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-pink-paisa.png`;

function absoluteUrl(path?: string | null) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function SeoHead({
  title,
  description,
  canonicalPath = "/",
  image,
  type = "website",
}: SeoHeadProps) {
  const canonical = absoluteUrl(canonicalPath) || SITE_URL;
  const ogImage = absoluteUrl(image) || DEFAULT_OG_IMAGE;
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Head>
  );
}
