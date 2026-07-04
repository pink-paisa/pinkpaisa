import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorProductDetailPage from "@/pages/VendorProductDetail";

export default function VendorProductCreateRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorProductDetailPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
