import PinkPagesPage from "@/pages/PinkPages";
import SeoHead from "@/components/SeoHead";

export default function PinkPagesRoute() {
  return (
    <>
      <SeoHead
        title="Pink Pages"
        description="Discover trusted women-led listings and curated businesses through Pink Pages."
        canonicalPath="/pink-pages"
      />
      <PinkPagesPage />
    </>
  );
}
