import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getServerSideProps as redirectInstagram } from "../../pages/instagram";
import { resolveTrendingServerResult } from "../../pages/instagram/trending";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import Footer from "@/components/Footer";
import { getAffiliateProductDisplayTitle } from "@/lib/affiliateProductDisplay";
import { PINK_PAISA_BRAND } from "@/lib/brand";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

describe("immediate monetisation public funnel", () => {
  it("centralizes the production Instagram identity and removes the retired rendered handle", () => {
    expect(PINK_PAISA_BRAND.instagramHandle).toBe("@pinkpaisaofficial");
    expect(PINK_PAISA_BRAND.instagramUrl).toBe("https://www.instagram.com/pinkpaisaofficial");

    const frontendRoot = resolve(process.cwd());
    const renderedSource = [
      ...sourceFiles(join(frontendRoot, "pages")),
      ...sourceFiles(join(frontendRoot, "src")),
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    const retiredUrl = ["https://instagram.com/pinkpaisa", "in"].join(".");
    const retiredWwwUrl = ["https://www.instagram.com/pinkpaisa", "in"].join(".");
    expect(renderedSource).not.toContain(retiredUrl);
    expect(renderedSource).not.toContain(retiredWwwUrl);

    render(createElement(Footer));
    expect(screen.getByRole("link", { name: "@pinkpaisaofficial" })).toHaveAttribute(
      "href",
      PINK_PAISA_BRAND.instagramUrl,
    );
  });

  it("uses editorial titles without modifying the authentic catalogue title", () => {
    const product = {
      title: "Authentic Amazon Catalogue Product Title",
      editorial_title: "Compact Pink Paisa Pick",
    };
    expect(getAffiliateProductDisplayTitle(product)).toBe("Compact Pink Paisa Pick");
    expect(product.title).toBe("Authentic Amazon Catalogue Product Title");
    expect(getAffiliateProductDisplayTitle({ ...product, editorial_title: "  " })).toBe(product.title);
  });

  it("redirects the legacy Instagram entrypoint to canonical Start Here", async () => {
    const result = await (redirectInstagram as unknown as (context: unknown) => Promise<Record<string, unknown>>)({});
    expect(result).toEqual({
      redirect: {
        destination: "/start-here",
        permanent: true,
      },
    });
  });

  it("redirects an unavailable trending collection instead of rendering a dead card", () => {
    expect(resolveTrendingServerResult([])).toEqual({
      redirect: {
        destination: "/instagram/picks",
        permanent: false,
      },
    });
    const product = { id: "pick-1", title: "Healthy pick" } as never;
    expect(resolveTrendingServerResult([product])).toEqual({ props: { products: [product] } });
  });
});
