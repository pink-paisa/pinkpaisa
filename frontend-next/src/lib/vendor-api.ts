import { API_URL, csrfHeadersFor } from "@/lib/api";

export type VendorApiFieldErrors = Record<string, string>;
export type VendorApiErrorPayload = {
  message?: string;
  errors?: string[];
  field_errors?: VendorApiFieldErrors;
  [key: string]: unknown;
};

export class VendorApiError extends Error {
  status: number;
  data: VendorApiErrorPayload;

  constructor(message: string, status: number, data: VendorApiErrorPayload = {}) {
    super(message);
    this.name = "VendorApiError";
    this.status = status;
    this.data = data;
  }
}

export function vendorHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
  };
}

export async function vendorFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const csrfHeaders = await csrfHeadersFor(String(options.method || "GET"));
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...vendorHeaders(),
      ...csrfHeaders,
      ...(options.headers as Record<string, string> || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new VendorApiError((data as any).message || "Request failed", res.status, (data as VendorApiErrorPayload) || {});
  return data as T;
}

export async function uploadVendorImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return vendorFetch<{ url: string; path: string }>("/uploads/image", {
    method: "POST",
    body: formData,
  });
}
