import { API_URL, ApiError } from "@/lib/api";

function getFileNameFromContentDisposition(value: string | null) {
  if (!value) return "";
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() || "";
}

export async function downloadApiFile(path: string, fallbackFileName = "pinkpaisa-download") {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data?.message || response.statusText, response.status, data);
  }

  const blob = await response.blob();
  const fileName = getFileNameFromContentDisposition(response.headers.get("Content-Disposition"))
    || fallbackFileName;
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}
