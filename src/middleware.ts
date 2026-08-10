import type { MiddlewareHandler } from "astro";
import { resolveOptions } from "./options.js";
import { rewriteHtml } from "./rewrite-html.js";
import type { AutoParamAstroOptions } from "./types.js";

/** Statuses that must not carry a response body (see the Fetch spec). */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Creates the Astro middleware that rewrites external links in HTML responses
 * rendered on demand (and, for prerendered routes, at build time).
 */
export function createMiddleware(
  options: AutoParamAstroOptions,
  siteHostname?: string,
): MiddlewareHandler {
  // Resolve once at module init, not once per request.
  const resolved = resolveOptions(options, siteHostname);

  return async (_context, next) => {
    const response = await next();

    if (NULL_BODY_STATUSES.has(response.status) || !response.body) return response;

    // Only process HTML responses.
    if (!response.headers.get("content-type")?.includes("text/html")) return response;

    let rewritten: string;
    try {
      const html = await response.text();
      rewritten = rewriteHtml(html, resolved).html;
    } catch {
      // Never let link rewriting take a page down; the body may already be
      // consumed at this point, so fall through to the original response.
      return response;
    }

    const headers = new Headers(response.headers);
    // The body has been decoded and its length changed, so any length or
    // encoding headers copied from the upstream response are now wrong.
    headers.delete("content-length");
    headers.delete("content-encoding");

    return new Response(rewritten, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
