import CustomerProtectedRoute from "@/components/auth/CustomerProtectedRoute";
import AccountPage from "@/pages/Account";

export default function AccountRoute() {
  return (
    <CustomerProtectedRoute>
      <AccountPage />
    </CustomerProtectedRoute>
  );
}
