import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorHistoryPage from "@/pages/VendorHistory";

export default function VendorHistoryRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorHistoryPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
