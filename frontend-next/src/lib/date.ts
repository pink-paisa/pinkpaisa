const INDIA_TIMEZONE = "Asia/Kolkata";

type DateInput = string | number | Date | null | undefined;

function normalizeDate(value: DateInput) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateIN(value: DateInput, options: Intl.DateTimeFormatOptions = {}) {
  const date = normalizeDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIMEZONE,
    ...options,
  }).format(date);
}

export function formatDateTimeIN(value: DateInput, options: Intl.DateTimeFormatOptions = {}) {
  return formatDateIN(value, options);
}
