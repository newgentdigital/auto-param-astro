import type {
  AutoParamAstroOptions,
  AutoParamMap,
  ResolvedAutoParamAstroOptions,
  ResolvedDomainParams,
} from "./types.js";

const PARAM_MODES = ["preserve", "override", "replace"] as const;

const DEFAULT_EXEMPT_DATA_ATTRIBUTES = ["data-auto-param-exempt"];

export function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lowercases a hostname and strips the trailing root label, so `Example.COM.`
 * and `example.com` compare equal.
 */
function normalizeHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();

  // Strip the root-label dots without a regex: /\.+$/ backtracks quadratically
  // on a long run of dots, and exempt domains come from user configuration.
  let end = host.length;
  while (end > 0 && host[end - 1] === ".") end--;

  return host.slice(0, end);
}

/** Normalizes a configured host pattern; `*.example.com` and `example.com` are equivalent. */
function normalizeHostPattern(pattern: string): string {
  const host = normalizeHost(pattern);
  return host.startsWith("*.") ? host.slice(2) : host;
}

function normalizeHostPatterns(patterns: readonly string[]): string[] {
  return patterns.map(normalizeHostPattern).filter(Boolean);
}

/** Stringifies a validated parameter map into the pre-resolved entry form. */
function resolveParams(params: AutoParamMap): (readonly [key: string, value: string])[] {
  return Object.entries(params).map(([key, value]) => [key, String(value)] as const);
}

function assertStringArray(value: unknown, optionName: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`[auto-param-astro] options.${optionName} must be an array of strings.`);
}

/** Validates one parameter map, naming `optionPath` in any error it throws. */
function assertValidParamMap(
  value: unknown,
  optionPath: string,
  { allowEmpty }: { allowEmpty: boolean },
): asserts value is AutoParamMap {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`[auto-param-astro] options.${optionPath} must be an object.`);

  const entries = Object.entries(value);
  if (!allowEmpty && entries.length === 0)
    throw new Error(
      `[auto-param-astro] options.${optionPath} must contain at least one parameter.`,
    );

  for (const [key, entry] of entries) {
    if (!key)
      throw new Error(`[auto-param-astro] options.${optionPath} contains an empty parameter name.`);

    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean")
      throw new Error(
        `[auto-param-astro] options.${optionPath}.${key} must be a string, number, or boolean.`,
      );

    if (typeof entry === "number" && !Number.isFinite(entry))
      throw new Error(`[auto-param-astro] options.${optionPath}.${key} must be a finite number.`);
  }
}

/**
 * Throws a descriptive error if the user-supplied options are unusable.
 *
 * The checks look redundant against the declared types, but this integration is
 * configured from `astro.config.mjs`, which is frequently plain JavaScript with
 * no type checking at all.
 */
/* oxlint-disable typescript/no-unnecessary-condition -- validating untyped JS input */
export function assertValidOptions(
  options: AutoParamAstroOptions,
): asserts options is AutoParamAstroOptions {
  if (!options || typeof options !== "object")
    throw new Error("[auto-param-astro] Options are required.");

  assertValidParamMap(options.params, "params", { allowEmpty: false });

  if (options.paramMode !== undefined && !PARAM_MODES.includes(options.paramMode))
    throw new Error(
      `[auto-param-astro] options.paramMode must be one of: ${PARAM_MODES.join(" | ")}.`,
    );

  if (options.domainParams !== undefined) {
    if (
      !options.domainParams ||
      typeof options.domainParams !== "object" ||
      Array.isArray(options.domainParams)
    )
      throw new Error(
        "[auto-param-astro] options.domainParams must be an object keyed by hostname.",
      );

    for (const [host, params] of Object.entries(options.domainParams)) {
      if (!normalizeHostPattern(host))
        throw new Error("[auto-param-astro] options.domainParams contains an empty hostname.");

      assertValidParamMap(params, `domainParams["${host}"]`, { allowEmpty: true });
    }
  }

  if (options.includeDomains !== undefined)
    assertStringArray(options.includeDomains, "includeDomains");

  if (options.exemptDomains !== undefined)
    assertStringArray(options.exemptDomains, "exemptDomains");

  if (options.exemptDataAttributes !== undefined)
    assertStringArray(options.exemptDataAttributes, "exemptDataAttributes");

  if (options.skipInternalLinks !== undefined && typeof options.skipInternalLinks !== "boolean")
    throw new Error("[auto-param-astro] options.skipInternalLinks must be a boolean.");
}
/* oxlint-enable typescript/no-unnecessary-condition */

/**
 * Validates the options, applies defaults, and hoists the per-link work
 * (stringification, host normalization) out of the rewrite hot path.
 *
 * @param options - User-supplied integration options.
 * @param siteHostname - Hostname from Astro's `site` config, used to resolve
 * `skipInternalLinks`. Ignored when that option is off.
 * @throws If the options are unusable. See {@link assertValidOptions}.
 */
export function resolveOptions(
  options: AutoParamAstroOptions,
  siteHostname?: string,
): ResolvedAutoParamAstroOptions {
  assertValidOptions(options);

  const exemptDomains = normalizeHostPatterns(options.exemptDomains ?? []);

  // Internal links are implemented as an implicit exempt domain, so one code
  // path handles both.
  if (options.skipInternalLinks && siteHostname) {
    const siteHost = normalizeHostPattern(siteHostname);
    if (siteHost && !exemptDomains.includes(siteHost)) exemptDomains.push(siteHost);
  }

  return {
    params: resolveParams(options.params),
    paramMode: options.paramMode ?? "preserve",
    // Least specific first, so more specific hosts overwrite when merged.
    domainParams: Object.entries(options.domainParams ?? {})
      .map(([host, params]): ResolvedDomainParams => ({
        host: normalizeHostPattern(host),
        params: resolveParams(params),
      }))
      .filter((entry) => entry.host && entry.params.length > 0)
      .toSorted((a, b) => a.host.length - b.host.length),
    includeDomains: normalizeHostPatterns(options.includeDomains ?? []),
    exemptDomains,
    exemptAttributeNames: (options.exemptDataAttributes ?? DEFAULT_EXEMPT_DATA_ATTRIBUTES)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  };
}

export { normalizeHost };
