import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorUploadsPage from "@/pages/VendorUploads";

export default function VendorUploadsRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorUploadsPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
