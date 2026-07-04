/* eslint-disable @typescript-eslint/no-explicit-any */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
const CSRF_COOKIE_NAME = "pinkpaisa_csrf";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let csrfRequest: Promise<string | null> | null = null;

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  status: number;
  field_errors?: FieldErrors;
  data: any;

  constructor(message: string, status: number, data: any = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.field_errors = data?.field_errors;
  }
}

export function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
  };
}

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

export async function ensureCsrfToken() {
  const existing = readCookie(CSRF_COOKIE_NAME);
  if (existing) return decodeURIComponent(existing);
  if (typeof window === "undefined") return null;

  csrfRequest = csrfRequest || fetch(`${API_URL}/auth/csrf`, { credentials: "include" })
    .then((res) => res.json().catch(() => ({})))
    .then((data) => String(data?.csrfToken || readCookie(CSRF_COOKIE_NAME) || "") || null)
    .finally(() => {
      csrfRequest = null;
    });

  return csrfRequest;
}

export async function csrfHeadersFor(method = "GET") {
  if (!UNSAFE_METHODS.has(String(method || "GET").toUpperCase())) return {};
  const token = await ensureCsrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}

/** Low-level fetch wrapper. Throws on non-OK responses. */
export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const csrfHeaders = await csrfHeadersFor(String(options.method || "GET"));
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : authHeaders()),
      ...csrfHeaders,
      ...(options.headers as Record<string, string> || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as any).message || res.statusText, res.status, data);
  return data as T;
}

/** Supabase-style {data, error} wrapper */
export async function apiQuery<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const data = await apiFetch<T>(path, options);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err as Error };
  }
}

// ── Table name → route path ────────────────────────────────
export const ROUTE_MAP: Record<string, string> = {
  blogs: "/blogs",
  workshops: "/workshops",
  products: "/virtual-products",
  physical_products: "/products",
  orders: "/orders",
  order_items: "/order-items",          // handled via /orders/:id/items
  workshop_bookings: "/workshop-bookings",
  workshop_sessions: "/quote-requests/sessions",
  workshop_quote_requests: "/quote-requests",
  polls: "/polls",
  poll_votes: "/polls/votes",
  poll_comments: "/polls/comments",
  pink_pages_categories: "/pink-pages/categories",
  pink_pages_listings: "/pink-pages/listings",
};

export function routeFor(table: string): string {
  return ROUTE_MAP[table] ?? `/${table.replace(/_/g, "-")}`;
}
