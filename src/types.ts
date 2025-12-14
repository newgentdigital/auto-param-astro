export type AutoParamValue = string | number | boolean;

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
   * Domains that are exempt globally.
   *
   * Matches exact domains and subdomains (e.g. 'example.com' matches
   * 'example.com' and 'www.example.com'). Supports leading-wildcard entries
   * like '*.example.com'.
   */
  exemptDomains?: string[];
}

export interface RewriteStats {
  filesScanned: number;
  filesChanged: number;
  linksScanned: number;
  linksChanged: number;
}
