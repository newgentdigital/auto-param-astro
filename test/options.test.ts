import { describe, expect, test } from "bun:test";
import { assertValidOptions, resolveOptions } from "../src/options.js";
import type { AutoParamAstroOptions } from "../src/types.js";

const invalid: [name: string, options: unknown][] = [
  ["missing options", undefined],
  ["non-object options", "nope"],
  ["missing params", {}],
  ["array params", { params: [] }],
  ["empty params", { params: {} }],
  ["empty param name", { params: { "": "x" } }],
  ["object param value", { params: { a: { b: 1 } } }],
  ["null param value", { params: { a: null } }],
  ["NaN param value", { params: { a: Number.NaN } }],
  ["unknown paramMode", { params: { a: "1" }, paramMode: "nope" }],
  ["non-array exemptDomains", { params: { a: "1" }, exemptDomains: "x" }],
  ["array domainParams", { params: { a: "1" }, domainParams: [] }],
  ["empty domainParams hostname", { params: { a: "1" }, domainParams: { "  ": { a: "1" } } }],
  ["non-object domainParams entry", { params: { a: "1" }, domainParams: { "e.com": "x" } }],
  ["invalid domainParams value", { params: { a: "1" }, domainParams: { "e.com": { a: null } } }],
  ["non-array includeDomains", { params: { a: "1" }, exemptDomains: [], includeDomains: "x" }],
  ["non-string exemptDataAttributes entry", { params: { a: "1" }, exemptDataAttributes: [1] }],
];

describe("assertValidOptions", () => {
  for (const [name, options] of invalid)
    test(`rejects ${name}`, () => {
      expect(() => assertValidOptions(options as AutoParamAstroOptions)).toThrow(
        /auto-param-astro/,
      );
    });

  test("accepts a fully specified config", () => {
    expect(() =>
      assertValidOptions({
        params: { a: "1", b: 2, c: false },
        paramMode: "replace",
        exemptDataAttributes: ["data-x"],
        domainParams: { "partner.com": { ref: "x" }, "shop.partner.com": {} },
        includeDomains: ["partner.com"],
        exemptDomains: ["example.com", "*.github.com"],
      }),
    ).not.toThrow();
  });
  test("names the offending domainParams host in the error", () => {
    expect(() =>
      assertValidOptions({
        params: { a: "1" },
        domainParams: { "partner.com": { ref: Number.NaN } },
      }),
    ).toThrow(/domainParams\["partner.com"\].ref/);
  });
});

describe("resolveOptions", () => {
  test("applies defaults", () => {
    const resolved = resolveOptions({ params: { a: 1 } });
    expect(resolved.paramMode).toBe("preserve");
    expect(resolved.exemptDomains).toEqual([]);
    expect(resolved.includeDomains).toEqual([]);
    expect(resolved.domainParams).toEqual([]);
    expect(resolved.exemptAttributeNames).toEqual(["data-auto-param-exempt"]);
    expect(resolved.params).toEqual([["a", "1"]]);
  });

  test("lowercases exempt attribute names", () => {
    const resolved = resolveOptions({ params: { a: 1 }, exemptDataAttributes: [" DATA-Skip "] });
    expect(resolved.exemptAttributeNames).toEqual(["data-skip"]);
  });

  test("orders domainParams from least to most specific host", () => {
    const resolved = resolveOptions({
      params: { a: 1 },
      domainParams: {
        "shop.partner.com": { ref: "shop" },
        "*.Partner.com": { ref: "partner" },
        "empty.com": {},
      },
    });
    expect(resolved.domainParams).toEqual([
      { host: "partner.com", params: [["ref", "partner"]] },
      { host: "shop.partner.com", params: [["ref", "shop"]] },
    ]);
  });

  test("normalizes exempt domains", () => {
    const resolved = resolveOptions({
      params: { a: 1 },
      exemptDomains: ["  *.Example.COM. ", "", "  "],
    });
    expect(resolved.exemptDomains).toEqual(["example.com"]);
  });

  test("an empty exemptDataAttributes array disables attribute exemptions", () => {
    const resolved = resolveOptions({
      params: { a: 1 },
      exemptDataAttributes: [],
    });
    expect(resolved.exemptAttributeNames).toEqual([]);
  });
});
