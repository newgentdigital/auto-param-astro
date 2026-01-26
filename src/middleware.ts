import type { MiddlewareHandler } from "astro";
import { rewriteHtmlExternalLinks } from "./rewrite-html.js";
import type { AutoParamAstroOptions } from "./types.js";

export function createMiddleware(
  options: AutoParamAstroOptions,
): MiddlewareHandler {
  return async (_context, next) => {
    const response = await next();

    // Only process HTML responses
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("text/html")) {
      return response;
    }

    // Get and rewrite HTML content
    const html = await response.text();
    const { html: rewrittenHtml } = rewriteHtmlExternalLinks(html, options);

    // Return new response with rewritten HTML
    return new Response(rewrittenHtml, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
