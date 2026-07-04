import VendorProtectedRoute from "@/components/vendor/VendorProtectedRoute";
import VendorPortalLayout from "@/components/vendor/VendorPortalLayout";
import VendorOrdersPage from "@/pages/VendorOrders";

export default function VendorOrdersRoute() {
  return (
    <VendorProtectedRoute>
      <VendorPortalLayout>
        <VendorOrdersPage />
      </VendorPortalLayout>
    </VendorProtectedRoute>
  );
}
