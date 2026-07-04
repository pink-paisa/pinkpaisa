import CustomerProtectedRoute from "@/components/auth/CustomerProtectedRoute";
import AccountAddressesPage from "@/pages/AccountAddresses";

export default function AccountAddressesRoute() {
  return (
    <CustomerProtectedRoute>
      <AccountAddressesPage />
    </CustomerProtectedRoute>
  );
}
