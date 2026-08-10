import { describe, expect, test } from "bun:test";
import { resolveOptions } from "../src/options.js";
import { rewriteHtml, rewriteHtmlExternalLinks } from "../src/rewrite-html.js";
import type { AutoParamAstroOptions } from "../src/types.js";

function rewrite(html: string, options: AutoParamAstroOptions): string {
  return rewriteHtmlExternalLinks(html, options).html;
}

const basic: AutoParamAstroOptions = { params: { utm_source: "newsletter" } };

describe("paramMode", () => {
  const options: AutoParamAstroOptions = {
    params: { utm_source: "newsletter", utm_medium: "email", ref: true, v: 2 },
  };
  const href = "https://example.com/pricing?utm_source=twitter&amp;utm_campaign=sale#faq";

  test("preserve keeps existing values and adds missing ones", () => {
    expect(rewrite(`<a href="${href}">x</a>`, options)).toContain("utm_source=twitter");
    expect(rewrite(`<a href="${href}">x</a>`, options)).toContain("utm_medium=email");
  });

  test("override replaces configured keys but keeps others", () => {
    const out = rewrite(`<a href="${href}">x</a>`, {
      ...options,
      paramMode: "override",
    });
    expect(out).toContain("utm_source=newsletter");
    expect(out).toContain("utm_campaign=sale");
  });

  test("replace drops all existing params but keeps path and hash", () => {
    const out = rewrite(`<a href="${href}">x</a>`, {
      ...options,
      paramMode: "replace",
    });
    expect(out).not.toContain("utm_campaign");
    expect(out).toContain("/pricing?");
    expect(out).toContain("#faq");
  });

  test("boolean and number values are stringified", () => {
    const out = rewrite('<a href="https://example.com/">x</a>', options);
    expect(out).toContain("ref=true");
    expect(out).toContain("v=2");
  });

  test("rewriting is idempotent across all modes", () => {
    for (const paramMode of ["preserve", "override", "replace"] as const) {
      const input = `<a href="${href}">x</a>`;
      const once = rewrite(input, { ...options, paramMode });
      expect(rewrite(once, { ...options, paramMode })).toBe(once);
    }
  });
});

describe("link selection", () => {
  test("leaves relative URLs alone", () => {
    const html = '<a href="/about">x</a><a href="./y">y</a><a href="#top">t</a>';
    expect(rewrite(html, basic)).toBe(html);
  });

  test("leaves non-HTTP schemes alone", () => {
    const html =
      '<a href="mailto:a@b.c">m</a><a href="tel:+1">t</a><a href="javascript:void(0)">j</a><a href="data:text/html,x">d</a>';
    expect(rewrite(html, basic)).toBe(html);
  });

  test("rewrites protocol-relative URLs without adding a scheme", () => {
    const out = rewrite('<a href="//example.com/p">x</a>', basic);
    expect(out).toBe('<a href="//example.com/p?utm_source=newsletter">x</a>');
  });

  test("ignores custom elements whose name starts with 'a'", () => {
    const html = '<a-scene href="https://example.com/">x</a-scene>';
    expect(rewrite(html, basic)).toBe(html);
  });

  test("ignores links inside script, style, textarea, and comments", () => {
    const cases = [
      "<script>const s = \"<a href='https://example.com/'>\";</script>",
      '<style>/* <a href="https://example.com/"> */</style>',
      '<textarea><a href="https://example.com/">x</a></textarea>',
      '<!-- <a href="https://example.com/">x</a> -->',
    ];
    for (const html of cases) expect(rewrite(html, basic)).toBe(html);
  });

  test("still rewrites links that follow a script block", () => {
    const out = rewrite('<script>var a = 1;</script><a href="https://example.com/">x</a>', basic);
    expect(out).toContain("utm_source=newsletter");
  });

  test("still rewrites links that follow a commented-out script tag", () => {
    // The `<script>` inside the comment is comment text, not an opening tag; if
    // it were treated as one, its missing close would swallow the whole page.
    const cases = [
      '<!-- <script> --> <a href="https://example.com/">x</a>',
      '<!-- <script src="x.js"></script> --><a href="https://example.com/">x</a>',
      '<!-- <textarea> --><a href="https://example.com/">x</a>',
    ];
    for (const html of cases) expect(rewrite(html, basic)).toContain("utm_source=newsletter");
  });

  test("rewrites area links inside an image map", () => {
    const out = rewrite('<area shape="rect" href="https://example.com/">', basic);
    expect(out).toBe('<area shape="rect" href="https://example.com/?utm_source=newsletter">');
  });

  test("ignores custom elements whose name starts with 'area'", () => {
    const html = '<area-map href="https://example.com/"></area-map>';
    expect(rewrite(html, basic)).toBe(html);
  });

  test("leaves unparseable URLs alone", () => {
    const html = '<a href="https://exa mple.com">x</a><a href="">e</a>';
    expect(rewrite(html, basic)).toBe(html);
  });
});

describe("attribute handling", () => {
  test("handles a '>' inside another attribute value", () => {
    const out = rewrite('<a title="a>b" href="https://example.com/">x</a>', basic);
    expect(out).toBe('<a title="a>b" href="https://example.com/?utm_source=newsletter">x</a>');
  });

  test("preserves the original quote style", () => {
    const out = rewrite("<a href='https://example.com/'>x</a>", basic);
    expect(out).toBe("<a href='https://example.com/?utm_source=newsletter'>x</a>");
  });

  test("quotes a previously unquoted href", () => {
    const out = rewrite("<a href=https://example.com/>x</a>", basic);
    expect(out).toBe('<a href="https://example.com/?utm_source=newsletter">x</a>');
  });

  test("re-encodes ampersands only when the source was encoded", () => {
    const encoded = rewrite('<a href="https://e.com/?a=1&amp;b=2">x</a>', basic);
    expect(encoded).toContain("&amp;utm_source=newsletter");
    expect(encoded).not.toMatch(/[^p];b=2&utm/);

    const raw = rewrite('<a href="https://e.com/?a=1&b=2">x</a>', basic);
    expect(raw).toContain("&utm_source=newsletter");
    expect(raw).not.toContain("&amp;");
  });

  test("decodes every spelling of an encoded ampersand", () => {
    for (const entity of ["&amp;", "&#38;", "&#038;", "&#x26;", "&#X26;", "&#x0026;"]) {
      const out = rewrite('<a href="https://e.com/?a=1' + entity + 'b=2">x</a>', basic);
      expect(out).toContain("a=1&amp;b=2&amp;utm_source=newsletter");
    }
  });

  test("decodes encoded ampersands exactly one level", () => {
    // "&amp;#38;" is the encoding of the literal text "&#38;". Decoding the
    // entities in sequence rather than in one pass would collapse it to "&".
    const out = rewrite('<a href="https://e.com/?a=&amp;#38;">x</a>', basic);
    expect(out).toContain("#38;");
  });

  test("ignores an href that only appears inside another attribute's value", () => {
    const out = rewrite(`<a title="href='x'" href="https://example.com/">x</a>`, basic);
    expect(out).toBe(`<a title="href='x'" href="https://example.com/?utm_source=newsletter">x</a>`);
  });

  test("rewrites the first href when a tag repeats the attribute", () => {
    // Browsers keep the first of a duplicated attribute; so do we.
    const out = rewrite('<a href="https://a.com/" href="https://b.com/">x</a>', basic);
    expect(out).toBe('<a href="https://a.com/?utm_source=newsletter" href="https://b.com/">x</a>');
  });

  test("handles a self-closing tag and an empty href", () => {
    expect(rewrite('<a href="https://example.com/"/>', basic)).toBe(
      '<a href="https://example.com/?utm_source=newsletter"/>',
    );
    expect(rewrite("<a href>x</a>", basic)).toBe("<a href>x</a>");
  });

  test("does not touch other tags or surrounding markup", () => {
    const out = rewrite('<p>before</p><a href="https://example.com/">x</a><p>after</p>', basic);
    expect(out.startsWith("<p>before</p>")).toBe(true);
    expect(out.endsWith("<p>after</p>")).toBe(true);
  });
});

describe("exemptions", () => {
  test("respects the default exempt data attribute", () => {
    const html = '<a href="https://example.com/" data-auto-param-exempt>x</a>';
    expect(rewrite(html, basic)).toBe(html);
  });

  test("respects custom exempt data attributes", () => {
    const html = '<a href="https://example.com/" data-no-params="">x</a>';
    expect(rewrite(html, { ...basic, exemptDataAttributes: ["data-no-params"] })).toBe(html);
  });

  test("does not treat a substring of another attribute as exempt", () => {
    const out = rewrite(
      '<a href="https://example.com/" data-auto-param-exempted-thing="1">x</a>',
      basic,
    );
    expect(out).toContain("utm_source=newsletter");
  });

  test("matches exempt attribute names case-insensitively", () => {
    const html = '<a href="https://example.com/" DATA-AUTO-PARAM-EXEMPT>x</a>';
    expect(rewrite(html, basic)).toBe(html);
  });

  test("ignores an exempt attribute name that only appears inside a value", () => {
    const cases = [
      '<a title="see data-auto-param-exempt" href="https://example.com/">x</a>',
      '<a href="https://example.com/" title=" data-auto-param-exempt ">x</a>',
    ];
    for (const html of cases) expect(rewrite(html, basic)).toContain("utm_source=newsletter");
  });

  test("exempts a domain and its subdomains", () => {
    const options = { ...basic, exemptDomains: ["example.com"] };
    const html = '<a href="https://www.example.com/">x</a><a href="https://example.com/">y</a>';
    expect(rewrite(html, options)).toBe(html);
  });

  test("treats a leading wildcard entry the same as a bare domain", () => {
    const options = { ...basic, exemptDomains: ["*.github.com"] };
    const html = '<a href="https://gist.github.com/">x</a>';
    expect(rewrite(html, options)).toBe(html);
  });

  test("does not exempt a domain that merely ends with the entry", () => {
    const out = rewrite('<a href="https://notexample.com/">x</a>', {
      ...basic,
      exemptDomains: ["example.com"],
    });
    expect(out).toContain("utm_source=newsletter");
  });

  test("matches exempt domains case-insensitively and ignores trailing dots", () => {
    const out = rewrite('<a href="https://WWW.Example.com./">x</a>', {
      ...basic,
      exemptDomains: ["  Example.COM  "],
    });
    expect(out).not.toContain("utm_source");
  });
});

describe("includeDomains", () => {
  const options: AutoParamAstroOptions = { ...basic, includeDomains: ["partner.com"] };

  test("rewrites only listed hosts and their subdomains", () => {
    expect(rewrite('<a href="https://partner.com/p">x</a>', options)).toContain("utm_source");
    expect(rewrite('<a href="https://shop.partner.com/p">x</a>', options)).toContain("utm_source");
  });

  test("leaves every other host alone", () => {
    const html = '<a href="https://other.com/p">x</a>';
    expect(rewrite(html, options)).toBe(html);
  });

  test("exemptDomains wins over includeDomains", () => {
    const html = '<a href="https://shop.partner.com/p">x</a>';
    expect(rewrite(html, { ...options, exemptDomains: ["shop.partner.com"] })).toBe(html);
  });
});

describe("domainParams", () => {
  const options: AutoParamAstroOptions = {
    params: { utm_source: "acme" },
    domainParams: {
      "partner.com": { ref: "partner" },
      "shop.partner.com": { ref: "shop", utm_source: "acme-shop" },
    },
  };

  test("merges the matching host's parameters on top of the global ones", () => {
    const out = rewrite('<a href="https://partner.com/p">x</a>', options);
    expect(out).toContain("utm_source=acme");
    expect(out).toContain("ref=partner");
  });

  test("the most specific host wins", () => {
    const out = rewrite('<a href="https://shop.partner.com/p">x</a>', options);
    expect(out).toContain("utm_source=acme-shop");
    expect(out).toContain("ref=shop");
    expect(out).not.toContain("ref=partner");
  });

  test("hosts with no matching entry get the global parameters only", () => {
    const out = rewrite('<a href="https://other.com/p">x</a>', options);
    expect(out).toBe('<a href="https://other.com/p?utm_source=acme">x</a>');
  });

  test("a domain override applies under override mode too", () => {
    const out = rewrite('<a href="https://shop.partner.com/p?ref=old">x</a>', {
      ...options,
      paramMode: "override",
    });
    expect(out).toContain("ref=shop");
    expect(out).not.toContain("ref=old");
  });
});

describe("skipInternalLinks", () => {
  const options: AutoParamAstroOptions = { ...basic, skipInternalLinks: true };

  test("leaves absolute links to the site host alone", () => {
    const html = '<a href="https://acme.com/about">x</a><a href="https://www.acme.com/x">y</a>';
    expect(rewriteHtml(html, resolveOptions(options, "acme.com")).html).toBe(html);
  });

  test("still rewrites other hosts", () => {
    const out = rewriteHtml(
      '<a href="https://other.com/">x</a>',
      resolveOptions(options, "acme.com"),
    );
    expect(out.html).toContain("utm_source=newsletter");
  });

  test("without a site host every absolute link stays eligible", () => {
    const out = rewriteHtml('<a href="https://acme.com/">x</a>', resolveOptions(options));
    expect(out.html).toContain("utm_source=newsletter");
  });
});

describe("statistics", () => {
  test("counts scanned and changed links", () => {
    const result = rewriteHtmlExternalLinks(
      '<a href="https://a.com/">1</a><a href="/rel">2</a><a href="https://b.com/?utm_source=newsletter">3</a>',
      basic,
    );
    expect(result.linksScanned).toBe(3);
    expect(result.linksChanged).toBe(1);
  });
});

describe("resolved options", () => {
  test("rewriteHtml matches rewriteHtmlExternalLinks", () => {
    const html = '<a href="https://e.com/">x</a>';
    const resolved = resolveOptions(basic);

    expect(rewriteHtml(html, resolved).html).toContain("utm_source=newsletter");
    expect(rewriteHtml(html, resolved)).toEqual(rewriteHtmlExternalLinks(html, basic));
  });
});
