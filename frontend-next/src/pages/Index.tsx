import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import FeaturedCatalogSection from "@/components/FeaturedCatalogSection";
import ProductsSection from "@/components/ProductsSection";
import ClienteleSection from "@/components/ClienteleSection";
import TrustSection from "@/components/TrustSection";
import CtaBanner from "@/components/CtaBanner";
import VendorPartnerSection from "@/components/VendorPartnerSection";
import Footer from "@/components/Footer";
import { Product } from "@/hooks/useProducts";
import type { CatalogProductsResponse } from "@/hooks/useCatalogProducts";

const Index = ({
  initialProducts,
  initialCatalogResponse,
}: {
  initialProducts?: Product[];
  initialCatalogResponse?: CatalogProductsResponse;
}) => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <FeaturedCatalogSection initialCatalogResponse={initialCatalogResponse} />
      <ProductsSection initialProducts={initialProducts} />
      <ClienteleSection />
      <TrustSection />
      <VendorPartnerSection />
      <CtaBanner />
      <Footer />
    </div>
  );
};

export default Index;
