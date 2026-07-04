import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorProductsPage from "@/pages/VendorProducts";

export default function VendorProductsRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorProductsPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
