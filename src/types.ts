/** A query parameter value. Numbers and booleans are stringified as written. */
export type AutoParamValue = string | number | boolean;

/** A set of query parameters, keyed by parameter name. */
export type AutoParamMap = Record<string, AutoParamValue>;

/** How configured parameters are merged with parameters already on a link. */
export type AutoParamParamMode =
  /** Existing values win; only missing configured parameters are added. */
  | "preserve"
  /** Configured parameters win; existing values for those keys are overwritten. */
  | "override"
  /** Every existing parameter is dropped, then configured parameters are added. */
  | "replace";

/**
 * Configuration for the `auto-param-astro` integration.
 *
 * Only {@link AutoParamAstroOptions.params | params} is required. Every other
 * field narrows which links are touched, or varies the parameters per
 * destination.
 */
export interface AutoParamAstroOptions {
  /**
   * Query parameters to add to matching links.
   *
   * At least one parameter is required. Values are stringified, so `2` becomes
   * `v=2` and `true` becomes `ref=true`.
   *
   * @example
   * ```js
   * params: { utm_source: "newsletter", utm_medium: "email" }
   * ```
   */
  params: AutoParamMap;

  /**
   * How configured parameters are merged with parameters already on the link.
   *
   * - `preserve` (default): existing values win; only missing configured
   *   parameters are added.
   * - `override`: configured parameters win; existing values for those keys are
   *   overwritten.
   * - `replace`: every existing parameter is dropped, then configured
   *   parameters are added.
   *
   * @defaultValue `"preserve"`
   */
  paramMode?: AutoParamParamMode;

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
   * Hostnames that are never rewritten.
   *
   * Entries match the host and its subdomains, so `example.com` also covers
   * `www.example.com`. A leading `*.` is optional and changes nothing.
   *
   * @defaultValue `[]`
   */
  exemptDomains?: string[];

  /**
   * Attribute names that opt a single link out when present on its tag.
   *
   * Pass an empty array to disable attribute-based exemptions entirely.
   *
   * @example
   * ```html
   * <a href="https://example.com" data-auto-param-exempt>Untagged link</a>
   * ```
   *
   * @defaultValue `["data-auto-param-exempt"]`
   */
  exemptDataAttributes?: string[];

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
 * lowercasing, parameter stringification, host normalization) has been hoisted
 * out of the hot path.
 *
 * @internal
 */
export interface ResolvedAutoParamAstroOptions {
  /** Globally configured parameters, pre-stringified. */
  params: readonly (readonly [key: string, value: string])[];
  paramMode: AutoParamParamMode;
  /** Per-host parameter overrides, ordered least to most specific host. */
  domainParams: readonly ResolvedDomainParams[];
  /** Normalized allowlist. Empty means every host is eligible. */
  includeDomains: readonly string[];
  /**
   * Normalized exempt hostnames, with any leading `*.` stripped. Each entry
   * matches itself and any subdomain of itself.
   */
  exemptDomains: readonly string[];
  /** Lowercased attribute names that exempt the tag they appear on. */
  exemptAttributeNames: readonly string[];
}

/** What a build-time rewrite pass changed, for the summary log line. */
export interface RewriteStats {
  /** HTML files whose contents were rewritten. */
  filesChanged: number;
  /** Links considered, including those left alone. */
  linksScanned: number;
  /** Links whose `href` was actually changed. */
  linksChanged: number;
}
