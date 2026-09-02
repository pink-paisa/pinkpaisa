import { DM_Sans, DM_Serif_Display } from "next/font/google";

/**
 * The Pink Paisa type system. These two families are the only webfonts the app
 * loads — DM Sans for UI and body copy, DM Serif Display for headings.
 *
 * They are self-hosted by `next/font` rather than fetched from the Google Fonts
 * CDN, which removes a render-blocking third-party request and lets Next.js emit
 * a size-adjusted local fallback so swapping in the real face causes no layout
 * shift.
 */
export const dmSans = DM_Sans({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-dm-serif",
});

/**
 * Declared on `:root` from `_app.tsx` rather than on a wrapper element, because
 * dialogs, sheets, popovers and toasts portal into `document.body` and would
 * otherwise fall outside the element carrying the custom properties.
 *
 * `next/font` is NOT processed inside `_document.tsx` on the Pages Router — it
 * silently emits no font files at all — so these must be loaded from `_app.tsx`.
 */
export const fontFaceVariables = {
  "--font-dm-sans": dmSans.style.fontFamily,
  "--font-dm-serif": dmSerifDisplay.style.fontFamily,
} as const;
