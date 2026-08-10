import { normalizeHost, resolveOptions } from "./options.js";
import type { AutoParamAstroOptions, ResolvedAutoParamAstroOptions } from "./types.js";

/**
 * Matches the start of an anchor tag only when followed by a tag terminator, so
 * custom elements such as `<a-scene>` or `<audio>` are not treated as links.
 */
const ANCHOR_START = /<a(?=[\s/>])/gi;

/**
 * Regions whose contents are raw text (or a comment) and therefore must never
 * be rewritten, even though they can contain markup-looking substrings.
 */
const SKIPPED_REGIONS: readonly { start: RegExp; end: string }[] = [
  { start: /<!--/g, end: "-->" },
  { start: /<script(?=[\s/>])/gi, end: "</script" },
  { start: /<style(?=[\s/>])/gi, end: "</style" },
  { start: /<textarea(?=[\s/>])/gi, end: "</textarea" },
];

const QUOTED_HREF = /\bhref\s*=\s*(?<quote>["'])(?<value>[^"']*)\k<quote>/i;
const UNQUOTED_HREF = /\bhref\s*=\s*(?<value>[^\s"'<>`]+)/i;

const NON_HTTP_SCHEME = /^(?:[a-z][a-z0-9+.-]*:)/i;

/**
 * Every spelling of an encoded ampersand, matched in one alternation.
 *
 * Decoding these in sequence rather than in a single pass would double-unescape:
 * `&amp;#38;` encodes the literal text `&#38;`, but replacing `&amp;` first and
 * `&#38;` second collapses it all the way down to `&`.
 */
const AMPERSAND_ENTITY_PATTERN = "&(?:amp|#0*38|#x0*26);";

/** Global, for replaceAll. */
const AMPERSAND_ENTITY_ALL = new RegExp(AMPERSAND_ENTITY_PATTERN, "gi");

/** Non-global, so `test` cannot carry lastIndex between calls. */
const AMPERSAND_ENTITY = new RegExp(AMPERSAND_ENTITY_PATTERN, "i");

function decodeHrefAttributeValue(raw: string): string {
  // The most common case in generated HTML is &amp; in query strings.
  return raw.replaceAll(AMPERSAND_ENTITY_ALL, "&");
}

function shouldEncodeAmpersands(rawOriginal: string): boolean {
  return AMPERSAND_ENTITY.test(rawOriginal);
}

function isDomainExempt(
  hostname: string,
  exemptDomains: ResolvedAutoParamAstroOptions["exemptDomains"],
): boolean {
  if (exemptDomains.length === 0) return false;

  const host = normalizeHost(hostname);
  if (!host) return false;

  return exemptDomains.some((base) => host === base || host.endsWith(`.${base}`));
}

/**
 * Finds the index of the `>` that closes a tag starting at `startIndex`,
 * skipping over quoted attribute values. Returns -1 if the tag is
 * unterminated.
 */
function findTagEnd(html: string, startIndex: number): number {
  let quote: '"' | "'" | null = null;

  for (let i = startIndex; i < html.length; i++) {
    const char = html[i];

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") return i;
  }

  return -1;
}

function hasExemptAttribute(tag: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(tag));
}

/**
 * Returns the rewritten href, or `null` when the link should be left alone
 * (relative URL, non-HTTP scheme, exempt domain, or unparseable).
 */
function rewriteHref(rawHref: string, options: ResolvedAutoParamAstroOptions): string | null {
  const decoded = decodeHrefAttributeValue(rawHref.trim());
  if (!decoded) return null;

  const isProtocolRelative = decoded.startsWith("//") && !decoded.startsWith("///");

  // Bail out early on relative URLs, fragments, and non-HTTP schemes
  // (mailto:, tel:, javascript:, data:, ...) without paying for URL parsing.
  if (!isProtocolRelative) {
    const scheme = NON_HTTP_SCHEME.exec(decoded)?.[0]?.toLowerCase();
    if (scheme !== "http:" && scheme !== "https:") return null;
  }

  let url: URL;
  try {
    url = new URL(isProtocolRelative ? `https:${decoded}` : decoded);
  } catch {
    return null;
  }

  if (isDomainExempt(url.hostname, options.exemptDomains)) return null;

  if (options.paramMode === "replace") url.search = "";

  for (const [key, value] of options.params) {
    if (options.paramMode === "preserve") {
      if (!url.searchParams.has(key)) url.searchParams.append(key, value);
      continue;
    }

    // "override" (and "replace", post-clearing) overwrites existing value(s).
    url.searchParams.set(key, value);
  }

  if (isProtocolRelative) return `//${url.host}${url.pathname}${url.search}${url.hash}`;

  return url.toString();
}

/**
 * Builds a sorted list of `[start, end)` ranges that must not be rewritten
 * (comments, `<script>`, `<style>`, and `<textarea>` contents).
 */
function findSkippedRegions(html: string): readonly [number, number][] {
  const regions: [number, number][] = [];
  const lowerHtml = html.toLowerCase();

  for (const { start, end } of SKIPPED_REGIONS) {
    start.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = start.exec(html)) !== null) {
      const closeIndex = lowerHtml.indexOf(end, start.lastIndex);
      // An unterminated region swallows the rest of the document.
      const regionEnd = closeIndex === -1 ? html.length : closeIndex;
      regions.push([match.index, regionEnd]);
      start.lastIndex = regionEnd;
    }
  }

  return regions.toSorted((a, b) => a[0] - b[0]);
}

export interface HtmlRewriteResult {
  html: string;
  linksScanned: number;
  linksChanged: number;
}

/**
 * Rewrites external `<a href>` targets in an HTML document, adding the
 * configured query parameters according to `paramMode`.
 *
 * Callers that process many documents should resolve their options once with
 * `resolveOptions()` and call `rewriteHtml()` instead.
 */
export function rewriteHtmlExternalLinks(
  html: string,
  options: AutoParamAstroOptions,
): HtmlRewriteResult {
  return rewriteHtml(html, resolveOptions(options));
}

/** As `rewriteHtmlExternalLinks`, but skips per-call option resolution. */
export function rewriteHtml(
  html: string,
  options: ResolvedAutoParamAstroOptions,
): HtmlRewriteResult {
  let linksScanned = 0;
  let linksChanged = 0;

  const skipped = findSkippedRegions(html);
  let skippedIndex = 0;

  const parts: string[] = [];
  let lastIndex = 0;

  ANCHOR_START.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ANCHOR_START.exec(html)) !== null) {
    const tagStart = match.index;

    // Skip anchors that live inside a raw-text or comment region.
    let region = skipped[skippedIndex];
    while (region && region[1] <= tagStart) {
      skippedIndex++;
      region = skipped[skippedIndex];
    }

    if (region && region[0] <= tagStart) {
      ANCHOR_START.lastIndex = region[1];
      continue;
    }

    const tagEnd = findTagEnd(html, ANCHOR_START.lastIndex);
    if (tagEnd === -1) break;

    const tag = html.slice(tagStart, tagEnd + 1);
    let rewrittenTag = tag;

    if (!hasExemptAttribute(tag, options.exemptAttributePatterns)) {
      // Prefer a quoted href; fall back to an unquoted attribute value.
      const quotedMatch = QUOTED_HREF.exec(tag);
      const unquotedMatch = quotedMatch ? null : UNQUOTED_HREF.exec(tag);
      const rawHref = quotedMatch?.groups?.value ?? unquotedMatch?.groups?.value;

      if (rawHref) {
        linksScanned++;

        const rewrittenHref = rewriteHref(rawHref, options);
        if (rewrittenHref !== null) {
          const finalHref = shouldEncodeAmpersands(rawHref)
            ? rewrittenHref.replaceAll("&", "&amp;")
            : rewrittenHref;

          if (finalHref !== rawHref) {
            linksChanged++;

            const quote = quotedMatch?.groups?.quote;
            rewrittenTag = quotedMatch
              ? tag.replace(QUOTED_HREF, () => `href=${quote}${finalHref}${quote}`)
              : // Unquoted attributes are re-emitted quoted, for safety.
                tag.replace(UNQUOTED_HREF, () => `href="${finalHref}"`);
          }
        }
      }
    }

    parts.push(html.slice(lastIndex, tagStart), rewrittenTag);
    lastIndex = tagEnd + 1;
    ANCHOR_START.lastIndex = lastIndex;
  }

  parts.push(html.slice(lastIndex));

  return { html: parts.join(""), linksScanned, linksChanged };
}
