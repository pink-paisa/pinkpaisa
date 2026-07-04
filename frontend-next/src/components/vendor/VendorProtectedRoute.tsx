import { ReactNode, useEffect } from "react";
import { useRouter } from "next/router";
import { useVendorAuth } from "@/contexts/VendorAuthContext";

const VendorProtectedRoute = ({ children }: { children?: ReactNode }) => {
  const { vendor, loading } = useVendorAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !vendor) {
      const redirect = encodeURIComponent(router.asPath || "/vendor/dashboard");
      void router.replace(`/vendor/login?redirect=${redirect}`);
    }
  }, [loading, router, vendor]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!vendor) {
    return null;
  }

  return <>{children}</>;
};

export default VendorProtectedRoute;
