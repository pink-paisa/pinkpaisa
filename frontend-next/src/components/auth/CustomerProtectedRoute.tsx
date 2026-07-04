import { ReactNode, useEffect } from "react";
import { useRouter } from "next/router";
import { useCustomerAuth } from "@/contexts/CustomerAuthContext";

const CustomerProtectedRoute = ({ children }: { children?: ReactNode }) => {
  const { user, loading } = useCustomerAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      const redirect = encodeURIComponent(router.asPath || "/account");
      void router.replace(`/account/auth?redirect=${redirect}`);
    }
  }, [loading, router, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
};

export default CustomerProtectedRoute;
