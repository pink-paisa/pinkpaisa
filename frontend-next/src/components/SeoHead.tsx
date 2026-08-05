import Head from "next/head";
import { absoluteSiteUrl, normalizeSiteUrl } from "@/lib/siteUrl";

type SeoHeadProps = {
  title: string;
  description: string;
  canonicalPath?: string;
  image?: string | null;
  type?: "website" | "article" | "product";
  noindex?: boolean;
};

const SITE_NAME = "Pink Paisa";
const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-pink-paisa.png`;

function absoluteUrl(path?: string | null) {
  return absoluteSiteUrl(path, SITE_URL);
}

export default function SeoHead({
  title,
  description,
  canonicalPath = "/",
  image,
  type = "website",
  noindex = false,
}: SeoHeadProps) {
  const canonical = absoluteUrl(canonicalPath) || SITE_URL;
  const ogImage = absoluteUrl(image) || DEFAULT_OG_IMAGE;
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noindex ? <meta name="robots" content="noindex,nofollow" /> : null}
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
