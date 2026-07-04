import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorDashboardPage from "@/pages/VendorDashboard";

export default function VendorDashboardRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorDashboardPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
