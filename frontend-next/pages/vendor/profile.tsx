import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorProfilePage from "@/pages/VendorProfile";

export default function VendorProfileRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorProfilePage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
