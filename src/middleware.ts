import { defineMiddleware } from "astro:middleware";
import { canonicalRedirectLocation } from "./lib/auth/host";

export const onRequest = defineMiddleware((context, next) => {
  const host = context.request.headers.get("host") ?? context.url.hostname;
  const location = canonicalRedirectLocation(host, context.url);
  if (location) return context.redirect(location, 301);
  return next();
});
