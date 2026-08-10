export type AutoParamValue = string | number | boolean;

/** A set of query parameters, keyed by parameter name. */
export type AutoParamMap = Record<string, AutoParamValue>;

export type AutoParamParamMode =
  /** (a) Respect existing parameters and only add missing configured ones. */
  | "preserve"
  /** (b) Add missing configured ones and overwrite configured keys if present. */
  | "override"
  /** (c) Remove all existing parameters and add only configured ones. */
  | "replace";

export interface AutoParamAstroOptions {
  /**
   * Query parameters to add to every external link.
   *
   * Example: { utm_source: 'newsletter', utm_medium: 'email' }
   */
  params: Record<string, AutoParamValue>;

  /**
   * Controls how query parameters are merged.
   *
   * - `preserve` (default): existing URL parameters win; only missing configured
   *   params are added.
   * - `override`: configured params win; existing values are overwritten for
   *   matching keys.
   * - `replace`: drop all existing URL parameters and add only configured params.
   */
  paramMode?: AutoParamParamMode;

  /**
   * Data-attributes that, when present on an <a> tag, opt that link out.
   *
   * Example: ['data-auto-param-exempt', 'data-no-params']
   */
  exemptDataAttributes?: string[];

  /**
   * Extra parameters for specific destinations, keyed by hostname.
   *
   * A host key matches that host and any subdomain of it, so `partner.com` also
   * matches `shop.partner.com`. A leading `*.` is optional and changes nothing.
   * Matching entries are merged on top of {@link AutoParamAstroOptions.params |
   * params}, most specific host last, so a domain entry can override a global
   * parameter for that destination.
   *
   * @example
   * ```js
   * params: { utm_source: "acme" },
   * domainParams: {
   *   "partner.com": { ref: "acme-partner" },
   *   "shop.partner.com": { ref: "acme-shop", utm_medium: "affiliate" },
   * }
   * ```
   *
   * @defaultValue `{}`
   */
  domainParams?: Record<string, AutoParamMap>;

  /**
   * Restricts rewriting to these hostnames. Every other link is left alone.
   *
   * Empty (the default) means every absolute `http(s)` link is eligible. Entries
   * match the host and its subdomains, as in
   * {@link AutoParamAstroOptions.domainParams | domainParams}. Use this for
   * affiliate or partner tagging, where only a known set of destinations should
   * carry parameters.
   *
   * {@link AutoParamAstroOptions.exemptDomains | exemptDomains} still wins, so a
   * host in both lists is left alone.
   *
   * @defaultValue `[]`
   */
  includeDomains?: string[];

  /**
   * Domains that are exempt globally.
   *
   * Matches exact domains and subdomains (e.g. 'example.com' matches
   * 'example.com' and 'www.example.com'). Supports leading-wildcard entries
   * like '*.example.com'.
   */
  exemptDomains?: string[];

  /**
   * Leaves absolute links that point back at your own site alone.
   *
   * Your site is taken from Astro's `site` config, and subdomains of it count as
   * internal too. Relative links are never rewritten regardless of this option;
   * this only affects links written as `https://your-site.com/...`.
   *
   * Requires `site` to be set in `astro.config.mjs`. Without it the integration
   * logs a warning and every absolute link stays eligible.
   *
   * @defaultValue `false`
   */
  skipInternalLinks?: boolean;
}

/** Extra parameters that apply to one host and its subdomains. */
export interface ResolvedDomainParams {
  /** Normalized hostname, with any leading `*.` stripped. */
  host: string;
  /** Parameters for this host, pre-stringified. */
  params: readonly (readonly [key: string, value: string])[];
}

/**
 * Options after defaults have been applied and per-run work (attribute-name
 * lowercasing, param stringification) has been hoisted out of the hot path.
 *
 * @internal
 */
export interface ResolvedAutoParamAstroOptions {
  /** Configured parameters, pre-stringified. */
  params: readonly (readonly [key: string, value: string])[];
  paramMode: AutoParamParamMode;
  /** Per-host parameter overrides, ordered least to most specific host. */
  domainParams: readonly ResolvedDomainParams[];
  /** Normalized allowlist. Empty means every host is eligible. */
  includeDomains: readonly string[];
  /** Lowercased attribute names that exempt the tag they appear on. */
  exemptAttributeNames: readonly string[];
  /**
   * Normalized exempt hostnames, with any leading `*.` stripped. Each entry
   * matches itself and any subdomain of itself.
   */
  exemptDomains: readonly string[];
}

export interface RewriteStats {
  filesChanged: number;
  linksScanned: number;
  linksChanged: number;
}
