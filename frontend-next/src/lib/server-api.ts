const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.pinkpaisa.in";

export function getApiUrl() {
  return API_URL.replace(/\/$/, "");
}

export function getSiteUrl() {
  return SITE_URL.replace(/\/$/, "");
}

export async function serverFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
