import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Vendor } from "@/lib/vendor";
import { vendorFetch } from "@/lib/vendor-api";

const VENDOR_STORAGE_KEY = "vendor_profile";

function toVendorSessionSnapshot(vendor: Vendor): Partial<Vendor> {
  return {
    id: vendor.id,
    owner_name: vendor.owner_name,
    mobile: vendor.mobile,
    email: vendor.email,
    business_name: vendor.business_name,
    shop_name: vendor.shop_name,
    business_type: vendor.business_type,
    website: vendor.website,
    status: vendor.status,
    email_verified: vendor.email_verified,
    max_products_allowed: vendor.max_products_allowed,
    current_uploaded_count: vendor.current_uploaded_count,
    remaining_slots: vendor.remaining_slots,
    pending_products_count: vendor.pending_products_count,
    approved_products_count: vendor.approved_products_count,
    rejected_products_count: vendor.rejected_products_count,
    assigned_categories: vendor.assigned_categories,
    has_category_restrictions: vendor.has_category_restrictions,
    kyc_verified: vendor.kyc_verified,
    bank_verified: vendor.bank_verified,
    kyc_documents: vendor.kyc_documents,
    bank_details: vendor.bank_details,
    bank_changed_at: vendor.bank_changed_at,
    bank_cooldown_ends_at: vendor.bank_cooldown_ends_at,
    payout_paused: vendor.payout_paused,
    payout_pause_reason: vendor.payout_pause_reason,
    verified_at: vendor.verified_at,
    created_at: vendor.created_at,
    updated_at: vendor.updated_at,
    meta: vendor.meta,
  };
}

type VendorAuthContextValue = {
  vendor: Vendor | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshVendor: () => Promise<void>;
};

const VendorAuthContext = createContext<VendorAuthContextValue | undefined>(undefined);

export const VendorAuthProvider = ({ children }: { children: ReactNode }) => {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);

  const persistVendor = useCallback((nextVendor: Vendor | null) => {
    if (typeof window === "undefined") return;
    if (nextVendor) sessionStorage.setItem(VENDOR_STORAGE_KEY, JSON.stringify(toVendorSessionSnapshot(nextVendor)));
    else sessionStorage.removeItem(VENDOR_STORAGE_KEY);

    setVendor(nextVendor);
  }, []);

  const logout = useCallback(async () => {
    try {
      await vendorFetch("/vendors/logout", { method: "POST" });
    } catch {
      // Best effort: local session should still clear even if the cookie is already gone.
    }
    persistVendor(null);
  }, [persistVendor]);

  const refreshVendor = useCallback(async () => {
    try {
      const profile = await vendorFetch<Vendor>("/vendors/me");
      persistVendor(profile);
    } catch {
      persistVendor(null);
    } finally {
      setLoading(false);
    }
  }, [persistVendor]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("vendor_token");
      const raw = sessionStorage.getItem(VENDOR_STORAGE_KEY);
      if (raw) {
        try {
          setVendor(JSON.parse(raw) as Vendor);
        } catch {
          sessionStorage.removeItem(VENDOR_STORAGE_KEY);
        }
      }
    }

    refreshVendor();
  }, [refreshVendor]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await vendorFetch<{ vendor: Vendor }>("/vendors/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    persistVendor(response.vendor);
  }, [persistVendor]);

  const value = useMemo(() => ({ vendor, loading, login, logout, refreshVendor }), [vendor, loading, login, logout, refreshVendor]);

  return <VendorAuthContext.Provider value={value}>{children}</VendorAuthContext.Provider>;
};

export const useVendorAuth = () => {
  const context = useContext(VendorAuthContext);
  if (!context) throw new Error("useVendorAuth must be used within VendorAuthProvider");
  return context;
};
