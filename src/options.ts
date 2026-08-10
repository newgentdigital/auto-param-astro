import type { AutoParamAstroOptions, ResolvedAutoParamAstroOptions } from "./types.js";

const PARAM_MODES = ["preserve", "override", "replace"] as const;

const DEFAULT_EXEMPT_DATA_ATTRIBUTES = ["data-auto-param-exempt"];

export function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function assertStringArray(value: unknown, optionName: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`[auto-param-astro] options.${optionName} must be an array of strings.`);
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

  if (!options.params || typeof options.params !== "object" || Array.isArray(options.params))
    throw new Error("[auto-param-astro] options.params must be an object.");

  const entries = Object.entries(options.params);
  if (entries.length === 0)
    throw new Error("[auto-param-astro] options.params must contain at least one parameter.");

  for (const [key, value] of entries) {
    if (!key)
      throw new Error("[auto-param-astro] options.params contains an empty parameter name.");

    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      throw new Error(
        `[auto-param-astro] options.params.${key} must be a string, number, or boolean.`,
      );

    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error(`[auto-param-astro] options.params.${key} must be a finite number.`);
  }

  if (options.paramMode !== undefined && !PARAM_MODES.includes(options.paramMode))
    throw new Error(
      `[auto-param-astro] options.paramMode must be one of: ${PARAM_MODES.join(" | ")}.`,
    );

  if (options.exemptDataAttributes !== undefined)
    assertStringArray(options.exemptDataAttributes, "exemptDataAttributes");

  if (options.exemptDomains !== undefined)
    assertStringArray(options.exemptDomains, "exemptDomains");
}
/* oxlint-enable typescript/no-unnecessary-condition */

/**
 * Applies defaults and hoists the per-link work (regex compilation, value
 * stringification, host normalization) out of the rewrite hot path.
 */
export function resolveOptions(options: AutoParamAstroOptions): ResolvedAutoParamAstroOptions {
  assertValidOptions(options);

  const exemptAttributeNames = options.exemptDataAttributes ?? DEFAULT_EXEMPT_DATA_ATTRIBUTES;

  return {
    params: Object.entries(options.params).map(([key, value]) => [key, String(value)] as const),
    paramMode: options.paramMode ?? "preserve",
    exemptAttributePatterns: exemptAttributeNames
      .filter(Boolean)
      // Match attribute names, not arbitrary substrings.
      .map((name) => new RegExp(`\\s${escapeRegExp(name)}(?=[\\s=>/]|$)`, "i")),
    // `*.example.com` and `example.com` are equivalent: both match the apex
    // domain and any subdomain of it.
    exemptDomains: (options.exemptDomains ?? [])
      .map((entry) => normalizeHost(entry))
      .map((entry) => (entry.startsWith("*.") ? entry.slice(2) : entry))
      .filter(Boolean),
  };
}

export { normalizeHost };
