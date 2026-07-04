import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { API_URL, csrfHeadersFor } from "@/lib/api";

type CustomerUser = {
  id: string;
  email: string;
  role: string;
  email_verified: boolean;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  wallet_balance: number;
};

type RegisterPayload = {
  full_name: string;
  email: string;
  password: string;
  phone: string;
};

type CustomerAuthContextType = {
  user: CustomerUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<CustomerUser>;
  register: (payload: RegisterPayload) => Promise<CustomerUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<CustomerUser | null>;
  updateUser: (next: Partial<CustomerUser>) => void;
};

const CustomerAuthContext = createContext<CustomerAuthContextType | undefined>(undefined);

async function customerFetch<T = any>(path: string, options: RequestInit = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const csrfHeaders = await csrfHeadersFor(String(options.method || "GET"));
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...csrfHeaders,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || response.statusText);
  return data as T;
}

export const CustomerAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const me = await customerFetch<CustomerUser>("/auth/me");
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await customerFetch<{ user: CustomerUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    return data.user;
  };

  const register = async (payload: RegisterPayload) => {
    const data = await customerFetch<{ user: CustomerUser }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await customerFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
  };

  const updateUser = (next: Partial<CustomerUser>) => {
    setUser((current) => (current ? { ...current, ...next } : current));
  };

  const value = useMemo(() => ({ user, loading, login, register, logout, refreshUser, updateUser }), [user, loading]);
  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>;
};

export const useCustomerAuth = () => {
  const ctx = useContext(CustomerAuthContext);
  if (!ctx) throw new Error("useCustomerAuth must be used within CustomerAuthProvider");
  return ctx;
};

export { customerFetch };
