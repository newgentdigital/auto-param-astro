import { normalizeHost, resolveOptions } from "./options.js";
import type { AutoParamAstroOptions, ResolvedAutoParamAstroOptions } from "./types.js";

/**
 * Matches the start of a link tag (`<a>` or `<area>`) only when followed by a
 * tag terminator, so custom elements such as `<a-scene>` or `<audio>` are not
 * treated as links. `area` is listed first because the alternation is ordered.
 */
const LINK_START = /<(?:area|a)(?=[\s/>])/gi;

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

/** Whether `hostname` equals, or is a subdomain of, any entry in `patterns`. */
function matchesHostList(hostname: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;

  const host = normalizeHost(hostname);
  if (!host) return false;

  return patterns.some((base) => host === base || host.endsWith(`.${base}`));
}

/**
 * The parameters to apply to `hostname`: the global set, with every matching
 * `domainParams` entry merged on top, most specific host last.
 */
function paramsForHost(
  hostname: string,
  options: ResolvedAutoParamAstroOptions,
): readonly (readonly [key: string, value: string])[] {
  if (options.domainParams.length === 0) return options.params;

  const host = normalizeHost(hostname);
  const matches = options.domainParams.filter(
    (entry) => host === entry.host || host.endsWith(`.${entry.host}`),
  );
  if (matches.length === 0) return options.params;

  // A Map keeps one entry per key, so the last write per key wins and the
  // resulting order stays stable.
  const merged = new Map(options.params);
  for (const entry of matches) for (const [key, value] of entry.params) merged.set(key, value);

  return [...merged];
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

/** The `href` attribute of a tag, located precisely enough to splice. */
interface HrefAttribute {
  /** Raw attribute value, entities and all. */
  raw: string;
  /** Offset of the value within the tag; inside the quotes when quoted. */
  start: number;
  /** Offset just past the value within the tag. */
  end: number;
  /** The quote character used, or `null` for an unquoted value. */
  quote: '"' | "'" | null;
}

interface TagAttributes {
  /** Lowercased attribute names, in source order. */
  names: string[];
  /** The first `href` attribute, or `null` when the tag has none. */
  href: HrefAttribute | null;
}

const ATTRIBUTE_NAME_END = new Set<string | undefined>([
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  "/",
  "=",
  ">",
]);

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/**
 * Walks the attributes of a single tag, from `startOffset` (just past the tag
 * name) to the closing `>`.
 *
 * Scanning the tag rather than pattern-matching it is what keeps an `href=` or a
 * `data-*` name that merely appears *inside* another attribute's value from
 * being mistaken for a real attribute.
 */
function parseTagAttributes(tag: string, startOffset: number): TagAttributes {
  const names: string[] = [];
  let href: HrefAttribute | null = null;

  // The final character is the closing `>`, which is never part of an attribute.
  const limit = tag.length - 1;
  let i = startOffset;

  while (i < limit) {
    if (isWhitespace(tag[i]) || tag[i] === "/") {
      i++;
      continue;
    }

    const nameStart = i;
    while (i < limit && !ATTRIBUTE_NAME_END.has(tag[i])) i++;
    const name = tag.slice(nameStart, i).toLowerCase();
    if (name) names.push(name);

    while (i < limit && isWhitespace(tag[i])) i++;
    if (tag[i] !== "=") continue;

    i++;
    while (i < limit && isWhitespace(tag[i])) i++;

    const quoteChar = tag[i];
    const quote = quoteChar === '"' || quoteChar === "'" ? quoteChar : null;
    if (quote) i++;

    const valueStart = i;
    if (quote) while (i < limit && tag[i] !== quote) i++;
    else while (i < limit && !isWhitespace(tag[i])) i++;

    if (name === "href" && !href)
      href = { raw: tag.slice(valueStart, i), start: valueStart, end: i, quote };

    // Step past the closing quote.
    if (quote) i++;
  }

  return { names, href };
}

/**
 * Returns the rewritten href, or `null` when the link should be left alone
 * (relative URL, non-HTTP scheme, exempt or non-included domain, unparseable).
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

  if (matchesHostList(url.hostname, options.exemptDomains)) return null;

  // An empty allowlist means "every host is eligible".
  if (options.includeDomains.length > 0 && !matchesHostList(url.hostname, options.includeDomains))
    return null;

  if (options.paramMode === "replace") url.search = "";

  for (const [key, value] of paramsForHost(url.hostname, options)) {
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

  // Each pattern scans the whole document independently, so one region can open
  // inside another — `<!-- <script> -->` finds a "script" that is really just
  // comment text, and an unterminated one would swallow the rest of the page.
  // An opener inside an already-skipped region is not an opener at all.
  const flattened: [number, number][] = [];
  let coveredUntil = -1;

  for (const region of regions.toSorted((a, b) => a[0] - b[0])) {
    if (region[0] < coveredUntil) continue;
    flattened.push(region);
    coveredUntil = region[1];
  }

  return flattened;
}

/** What a call to {@link rewriteHtml} changed. */
export interface HtmlRewriteResult {
  /** The rewritten document, or the input unchanged when nothing matched. */
  html: string;
  /** Links considered, including those left alone. */
  linksScanned: number;
  /** Links whose `href` was actually changed. */
  linksChanged: number;
}

/**
 * Rewrites the external `<a href>` and `<area href>` targets in an HTML
 * document, adding the configured query parameters according to `paramMode`.
 *
 * The rewrite is idempotent: running it twice over the same document produces
 * the same result as running it once.
 *
 * @param html - A complete or partial HTML document.
 * @param options - The same options the integration takes.
 * @throws If the options are unusable. See {@link assertValidOptions}.
 *
 * @example
 * ```ts
 * const { html } = rewriteHtmlExternalLinks(source, {
 *   params: { utm_source: "docs" },
 * });
 * ```
 *
 * @remarks
 * Callers that process many documents should resolve their options once with
 * `resolveOptions()` and call {@link rewriteHtml} instead.
 */
export function rewriteHtmlExternalLinks(
  html: string,
  options: AutoParamAstroOptions,
): HtmlRewriteResult {
  return rewriteHtml(html, resolveOptions(options));
}

/**
 * As {@link rewriteHtmlExternalLinks}, but takes pre-resolved options so that
 * repeated calls skip validation and regex compilation.
 *
 * @internal
 */
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

  LINK_START.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LINK_START.exec(html)) !== null) {
    const tagStart = match.index;

    // Skip links that live inside a raw-text or comment region.
    let region = skipped[skippedIndex];
    while (region && region[1] <= tagStart) {
      skippedIndex++;
      region = skipped[skippedIndex];
    }

    if (region && region[0] <= tagStart) {
      LINK_START.lastIndex = region[1];
      continue;
    }

    const tagEnd = findTagEnd(html, LINK_START.lastIndex);
    if (tagEnd === -1) break;

    const tag = html.slice(tagStart, tagEnd + 1);
    let rewrittenTag = tag;

    const { names, href } = parseTagAttributes(tag, match[0].length);
    const isExempt = options.exemptAttributeNames.some((name) => names.includes(name));

    if (href?.raw && !isExempt) {
      linksScanned++;

      const rewrittenHref = rewriteHref(href.raw, options);
      if (rewrittenHref !== null) {
        const finalHref = shouldEncodeAmpersands(href.raw)
          ? rewrittenHref.replaceAll("&", "&amp;")
          : rewrittenHref;

        if (finalHref !== href.raw) {
          linksChanged++;

          // Unquoted attribute values are re-emitted quoted, for safety.
          const quote = href.quote ?? '"';
          rewrittenTag =
            tag.slice(0, href.start) +
            (href.quote ? finalHref : `${quote}${finalHref}${quote}`) +
            tag.slice(href.end);
        }
      }
    }

    parts.push(html.slice(lastIndex, tagStart), rewrittenTag);
    lastIndex = tagEnd + 1;
    LINK_START.lastIndex = lastIndex;
  }

  parts.push(html.slice(lastIndex));

  return { html: parts.join(""), linksScanned, linksChanged };
}
