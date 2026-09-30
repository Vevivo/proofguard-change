export const PUBLIC_APP_URL = "https://proofguardchange.ar.io";
export const PUBLIC_API_ORIGIN = "https://proofguard-api.vevivo.art";

declare global {
  interface Window {
    __PROOFGUARD_API_ORIGIN__?: string;
  }
}

export function publicApiUrl(path: string) {
  const origin =
    typeof window === "undefined"
      ? ""
      : window.__PROOFGUARD_API_ORIGIN__?.trim() || "";
  return origin ? new URL(path, origin).toString() : path;
}
