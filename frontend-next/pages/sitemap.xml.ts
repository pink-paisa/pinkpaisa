import type { GetServerSideProps } from "next";
import { financialCalculatorGroups } from "@/data/financialCalculators";
import type { Blog } from "@/hooks/useBlogs";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";
import type { Workshop } from "@/hooks/useWorkshops";
import { getSiteUrl, serverFetch } from "@/lib/server-api";

const STATIC_PATHS = [
  "",
  "/products",
  "/instagram",
  "/instagram/picks",
  "/instagram/trending",
  "/affiliate-disclosure",
  "/blogs",
  "/workshops",
  "/pink-pages",
  "/quiz",
  "/predictions",
  "/financial-calculator",
];

type SitemapItem = {
  loc: string;
  lastmod?: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIsoDate(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function renderSitemap(items: SitemapItem[]) {
  const body = items
    .map((item) => {
      const lastmod = item.lastmod ? `<lastmod>${escapeXml(item.lastmod)}</lastmod>` : "";
      return `<url><loc>${escapeXml(item.loc)}</loc>${lastmod}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const siteUrl = getSiteUrl();

  const [products, blogs, workshops] = await Promise.all([
    serverFetch<CatalogProductsResponse>("/products?include_meta=true&_page=1&_limit=5000").catch(() => null),
    serverFetch<Blog[]>("/blogs").catch(() => []),
    serverFetch<Workshop[]>("/workshops").catch(() => []),
  ]);

  const calculatorPaths = financialCalculatorGroups.flatMap((group) =>
    group.items.map((item) => `/financial-calculator/${item.slug}`),
  );

  const items: SitemapItem[] = [
    ...STATIC_PATHS.map((path) => ({ loc: `${siteUrl}${path}` })),
    ...calculatorPaths.map((path) => ({ loc: `${siteUrl}${path}` })),
    ...((products?.items ?? []).map((product) => ({
      loc: `${siteUrl}/product/${product.slug}`,
      lastmod: toIsoDate(product.updatedAt || product.updated_at || product.createdAt || product.created_at),
    })) as SitemapItem[]),
    ...(blogs.map((blog) => ({
      loc: `${siteUrl}/blogs/${blog.slug}`,
      lastmod: toIsoDate(blog.updated_at || blog.published_at || blog.created_at),
    })) as SitemapItem[]),
    ...(workshops.map((workshop) => ({
      loc: `${siteUrl}/workshop-booking?workshop=${workshop.slug}`,
      lastmod: toIsoDate(workshop.created_at),
    })) as SitemapItem[]),
  ];

  res.setHeader("Content-Type", "application/xml");
  res.write(renderSitemap(items));
  res.end();

  return { props: {} };
};

export default function SitemapXml() {
  return null;
}
