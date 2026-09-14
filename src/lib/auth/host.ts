export const CANONICAL_HOST = "biggamesunday.com";
export const WWW_HOST = "www.biggamesunday.com";

/** 301 www → apex so parent sessions share one localStorage origin. */
export function canonicalRedirectLocation(host: string, url: URL): string | null {
  const hostname = (host.split(":")[0] ?? host).toLowerCase();
  if (hostname !== WWW_HOST) return null;
  const next = new URL(url.toString());
  next.hostname = CANONICAL_HOST;
  next.protocol = "https:";
  next.port = "";
  return next.toString();
}
