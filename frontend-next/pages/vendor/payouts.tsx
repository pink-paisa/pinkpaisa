import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorPayoutsPage from "@/pages/VendorPayouts";

export default function VendorPayoutsRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorPayoutsPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
