import { useCallback, useEffect, useState } from "react";
import { customerFetch } from "@/contexts/CustomerAuthContext";

export type UserAddress = {
  id: string;
  user_id?: string | null;
  label: string;
  full_name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  address_type: "home" | "work" | "other";
  is_default_shipping: boolean;
  is_default_billing: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AddressDraft = {
  label: string;
  full_name: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  address_type: "home" | "work" | "other";
  is_default_shipping: boolean;
};

export const EMPTY_ADDRESS_DRAFT: AddressDraft = {
  label: "",
  full_name: "",
  phone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  state: "",
  pincode: "",
  country: "India",
  address_type: "home",
  is_default_shipping: false,
};

export const mapAddressToDraft = (address: UserAddress): AddressDraft => ({
  label: address.label || "",
  full_name: address.full_name || "",
  phone: address.phone || "",
  line1: address.line1 || "",
  line2: address.line2 || "",
  landmark: address.landmark || "",
  city: address.city || "",
  state: address.state || "",
  pincode: address.pincode || "",
  country: address.country || "India",
  address_type: address.address_type || "home",
  is_default_shipping: Boolean(address.is_default_shipping),
});

export const formatAddressLines = (address: Pick<UserAddress, "line1" | "line2" | "landmark" | "city" | "state" | "pincode" | "country">) =>
  [
    address.line1,
    address.line2,
    address.landmark,
    [address.city, address.state].filter(Boolean).join(", "),
    [address.pincode, address.country].filter(Boolean).join(" • "),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

export const useAccountAddresses = () => {
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAddresses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customerFetch<UserAddress[]>("/account/addresses");
      setAddresses(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  const createAddress = useCallback(async (payload: AddressDraft) => {
    const created = await customerFetch<UserAddress>("/account/addresses", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await loadAddresses();
    return created;
  }, [loadAddresses]);

  const updateAddress = useCallback(async (id: string, payload: AddressDraft) => {
    const updated = await customerFetch<UserAddress>(`/account/addresses/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    await loadAddresses();
    return updated;
  }, [loadAddresses]);

  const deleteAddress = useCallback(async (id: string) => {
    await customerFetch(`/account/addresses/${id}`, { method: "DELETE" });
    await loadAddresses();
  }, [loadAddresses]);

  const setDefaultAddress = useCallback(async (id: string) => {
    const updated = await customerFetch<UserAddress>(`/account/addresses/${id}/set-default`, {
      method: "POST",
    });
    await loadAddresses();
    return updated;
  }, [loadAddresses]);

  return {
    addresses,
    loading,
    loadAddresses,
    createAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
  };
};
