import CustomerProtectedRoute from "@/components/auth/CustomerProtectedRoute";
import AccountOrderDetailPage from "@/pages/AccountOrderDetail";

export default function AccountOrderDetailRoute() {
  return (
    <CustomerProtectedRoute>
      <AccountOrderDetailPage />
    </CustomerProtectedRoute>
  );
}
