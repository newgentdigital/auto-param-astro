import { URL } from "url";
import type { AutoParamAstroOptions, AutoParamValue } from "./types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHrefAttributeValue(raw: string): string {
  // The most common case in generated HTML is &amp; in query strings.
  return raw
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x26;", "&");
}

function shouldEncodeAmpersands(rawOriginal: string): boolean {
  return (
    rawOriginal.includes("&amp;") ||
    rawOriginal.includes("&#38;") ||
    rawOriginal.toLowerCase().includes("&#x26;")
  );
}

function encodeAmpersandsIfNeeded(value: string, encode: boolean): string {
  return encode ? value.replaceAll("&", "&amp;") : value;
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function isDomainExempt(
  hostname: string,
  exemptDomains: readonly string[],
): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;

  for (const rawEntry of exemptDomains) {
    const entry = normalizeHost(rawEntry);
    if (!entry) continue;

    if (entry.startsWith("*.")) {
      const base = entry.slice(2);
      if (host === base || host.endsWith(`.${base}`)) return true;
      continue;
    }

    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }

  return false;
}

function getDefaultedOptions(
  options: AutoParamAstroOptions,
): Required<AutoParamAstroOptions> {
  return {
    params: options.params,
    paramMode: options.paramMode ?? "preserve",
    exemptDataAttributes: options.exemptDataAttributes ?? [
      "data-auto-param-exempt",
    ],
    exemptDomains: options.exemptDomains ?? [],
  };
}

function findTagEnd(html: string, startIndex: number): number {
  let quote: '"' | "'" | "`" | null = null;
  for (let i = startIndex; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === ">") return i;
  }

  return -1;
}

function hasExemptAttribute(
  tag: string,
  exemptDataAttributes: readonly string[],
): boolean {
  for (const attrName of exemptDataAttributes) {
    if (!attrName) continue;

    // Ensure we match attribute names, not arbitrary substrings.
    const re = new RegExp(`\\s${escapeRegExp(attrName)}(?=\\s|=|>|\\/)`, "i");
    if (re.test(tag)) return true;
  }
  return false;
}

function stringifyParamValue(value: AutoParamValue): string {
  return String(value);
}

function rewriteHref(
  rawHref: string,
  options: Required<AutoParamAstroOptions>,
): string | null {
  const decoded = decodeHrefAttributeValue(rawHref.trim());
  if (!decoded) return null;

  if (
    decoded.startsWith("mailto:") ||
    decoded.startsWith("tel:") ||
    decoded.startsWith("#")
  )
    return null;

  const isProtocolRelative = decoded.startsWith("//");
  let url: URL;
  try {
    url = new URL(isProtocolRelative ? `https:${decoded}` : decoded);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isDomainExempt(url.hostname, options.exemptDomains)) return null;

  if (options.paramMode === "replace") {
    url.search = "";
  }

  for (const [key, value] of Object.entries(options.params)) {
    if (!key) continue;

    if (options.paramMode === "preserve" && url.searchParams.has(key)) {
      continue;
    }

    if (options.paramMode === "preserve") {
      url.searchParams.append(key, stringifyParamValue(value));
      continue;
    }

    // "override" (and also "replace" after clearing) overwrites any existing value(s).
    url.searchParams.set(key, stringifyParamValue(value));
  }

  if (isProtocolRelative) {
    return `//${url.host}${url.pathname}${url.search}${url.hash}`;
  }

  return url.toString();
}

export interface HtmlRewriteResult {
  html: string;
  linksScanned: number;
  linksChanged: number;
}

export function rewriteHtmlExternalLinks(
  html: string,
  userOptions: AutoParamAstroOptions,
): HtmlRewriteResult {
  const options = getDefaultedOptions(userOptions);

  let linksScanned = 0;
  let linksChanged = 0;

  const anchorStart = /<a\b/gi;
  let lastIndex = 0;
  const parts: string[] = [];

  let match: RegExpExecArray | null;
  // Iterate over all <a ...> tags without using a constant-condition loop.
  while ((match = anchorStart.exec(html)) !== null) {
    const tagStart = match.index;
    const tagEnd = findTagEnd(html, anchorStart.lastIndex);
    if (tagEnd === -1) break;

    const tag = html.slice(tagStart, tagEnd + 1);
    let rewrittenTag = tag;

    if (!hasExemptAttribute(tag, options.exemptDataAttributes)) {
      // Prefer quoted href first.
      const quotedHrefRe =
        /\bhref\s*=\s*(?<quote>["'])(?<value>.*?)\k<quote>/is;
      const unquotedHrefRe = /\bhref\s*=\s*(?<value>[^\s"'<>`]+)/is;

      let rawHref: string | undefined;
      let quote: string | undefined;
      let usedQuoted = false;

      const quotedMatch = quotedHrefRe.exec(tag);
      if (quotedMatch?.groups) {
        rawHref = quotedMatch.groups.value;
        quote = quotedMatch.groups.quote;
        usedQuoted = true;
      } else {
        const unquotedMatch = unquotedHrefRe.exec(tag);
        if (unquotedMatch?.groups) {
          rawHref = unquotedMatch.groups.value;
          usedQuoted = false;
        }
      }

      if (rawHref) {
        linksScanned++;
        const encodeAmpersands = shouldEncodeAmpersands(rawHref);
        const rewrittenHref = rewriteHref(rawHref, options);
        if (rewrittenHref) {
          const finalHref = encodeAmpersandsIfNeeded(
            rewrittenHref,
            encodeAmpersands,
          );
          const same = finalHref === rawHref;
          if (!same) {
            linksChanged++;
            if (usedQuoted && quote) {
              rewrittenTag = tag.replace(
                quotedHrefRe,
                () => `href=${quote}${finalHref}${quote}`,
              );
            } else {
              // If the original attribute was unquoted, rewrite it with quotes for safety.
              rewrittenTag = tag.replace(unquotedHrefRe, `href="${finalHref}"`);
            }
          }
        }
      }
    }

    parts.push(html.slice(lastIndex, tagStart), rewrittenTag);
    lastIndex = tagEnd + 1;
    anchorStart.lastIndex = lastIndex;
  }

  parts.push(html.slice(lastIndex));

  return {
    html: parts.join(""),
    linksScanned,
    linksChanged,
  };
}
