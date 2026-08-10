![Repository banner for @newgentdigital/auto-param-astro](https://raw.githubusercontent.com/newgentdigital/.github/refs/heads/main/banner.png)

# @newgentdigital/auto-param-astro

Astro integration that adds query parameters to the links in your site's HTML — UTM tags, referral codes, affiliate IDs — without touching a single template.

Write `<a href="https://partner.com/pricing">` and ship `<a href="https://partner.com/pricing?utm_source=acme">`. It runs at build time and for pages rendered on demand, so every route is covered.

## Requirements

- Astro `^7.2.0`
- Node `>=22.12.0` (or Bun)

## Install

```bash
bun add @newgentdigital/auto-param-astro
# or
npm i @newgentdigital/auto-param-astro
```

## Quick start

Add the integration and list the parameters you want. Everything else is optional.

```js
// astro.config.mjs
import autoParamAstro from "@newgentdigital/auto-param-astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://acme.com",
  integrations: [
    autoParamAstro({
      params: {
        utm_source: "acme",
        utm_medium: "referral",
      },
      // Leave links back to acme.com alone. Needs `site` above.
      skipInternalLinks: true,
    }),
  ],
});
```

Run `astro build`. The integration reports what it changed:

```text
[@newgentdigital/auto-param-astro] Added parameters to 24 of 31 links in 12 of 14 HTML files (38ms).
```

Parameters appear in `astro dev` too, so you can check a page before you ship it.

## What gets rewritten

| Rewritten                                            | Left alone                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `<a href="https://example.com/">`                    | Relative links: `/about`, `./x`, `#top`                                 |
| `<a href="//example.com/">` (protocol-relative)      | Other schemes: `mailto:`, `tel:`, `javascript:`, `data:`                |
| `<a href='...'>` and `<a href=...>` (any quoting)    | Anything inside `<script>`, `<style>`, `<textarea>`, or an HTML comment |
| `<area href="https://example.com/">` in an image map | Custom elements such as `<a-scene>` and `<audio>`                       |
| Links in HTML copied from `public/`                  | URLs that cannot be parsed                                              |
|                                                      | Links you exempt — see [Options](#options)                              |

Encoded ampersands survive: an `href` written with `&amp;` comes back with `&amp;`, and one written with a bare `&` comes back bare.

Only `href` on `<a>` and `<area>` is touched. Form actions, `<link>` tags, and URLs inside JavaScript or CSS are left as they are.

## Options

`params` is required; every other option narrows what gets touched or varies the parameters per destination.

### `params`

**Type:** `Record<string, string | number | boolean>` · **Required**

The parameters to add. Values are stringified, so `v: 2` becomes `v=2` and `ref: true` becomes `ref=true`.

```js
autoParamAstro({
  params: { utm_source: "newsletter", utm_medium: "email", v: 2 },
});
```

### `paramMode`

**Type:** `"preserve" | "override" | "replace"` · **Default:** `"preserve"`

What happens when the link already carries a parameter you configured. See [Choosing a `paramMode`](#choosing-a-parammode).

### `skipInternalLinks`

**Type:** `boolean` · **Default:** `false`

Leaves absolute links back to your own site alone — `<a href="https://acme.com/pricing">` on `acme.com`. Subdomains count as internal too.

Requires `site` in your Astro config. Without it, the integration warns and treats every absolute link as external.

Relative links are never rewritten either way, so this only matters for pages that link to themselves by full URL.

### `exemptDomains`

**Type:** `string[]` · **Default:** `[]`

Hostnames that are never rewritten. Each entry matches the host and its subdomains, so `example.com` also covers `www.example.com`. A leading `*.` is optional and changes nothing.

```js
autoParamAstro({
  params: { utm_source: "acme" },
  exemptDomains: ["stripe.com", "*.github.com"],
});
```

### `includeDomains`

**Type:** `string[]` · **Default:** `[]`

Turns the rule around: when this list is non-empty, **only** these hosts are rewritten. Use it for affiliate or partner tagging, where a stray parameter on an unrelated link is worse than a missing one.

`exemptDomains` still wins, so a host in both lists is left alone.

```js
autoParamAstro({
  params: { utm_source: "acme" },
  includeDomains: ["partner.com", "affiliate.net"],
});
```

### `domainParams`

**Type:** `Record<string, Record<string, string | number | boolean>>` · **Default:** `{}`

Extra parameters for specific destinations, keyed by hostname. Matching entries are merged on top of `params`, most specific host last, so a destination can override a global value.

```js
autoParamAstro({
  params: { utm_source: "acme" },
  domainParams: {
    "partner.com": { ref: "acme-partner" },
    "shop.partner.com": { ref: "acme-shop", utm_medium: "affiliate" },
  },
});
```

| Link                        | Result                                                |
| --------------------------- | ----------------------------------------------------- |
| `https://other.com/`        | `?utm_source=acme`                                    |
| `https://partner.com/`      | `?utm_source=acme&ref=acme-partner`                   |
| `https://shop.partner.com/` | `?utm_source=acme&ref=acme-shop&utm_medium=affiliate` |

### `exemptDataAttributes`

**Type:** `string[]` · **Default:** `["data-auto-param-exempt"]`

Attribute names that opt a single link out. Pass `[]` to turn attribute-based exemptions off entirely.

```html
<a href="https://example.com" data-auto-param-exempt>This link is left alone</a>
```

Only real attributes count — the name appearing inside another attribute's value does nothing.

## Choosing a `paramMode`

Say this is your config:

```js
autoParamAstro({
  params: {
    utm_source: "newsletter",
    utm_medium: "email",
    utm_term: "winter",
  },
});
```

...and a page contains this link, which already carries campaign parameters of its own:

```text
https://example.com/pricing?utm_source=twitter&utm_campaign=sale#faq
```

| Mode                 | Behavior                                                            | Result                                                                          |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `preserve` (default) | The link's own values win. Only missing parameters are added.       | `?utm_source=twitter&utm_campaign=sale&utm_medium=email&utm_term=winter#faq`    |
| `override`           | Your values win for the keys you configured. Other parameters stay. | `?utm_source=newsletter&utm_campaign=sale&utm_medium=email&utm_term=winter#faq` |
| `replace`            | Every existing parameter is dropped. Path and hash stay.            | `?utm_source=newsletter&utm_medium=email&utm_term=winter#faq`                   |

Pick `preserve` when authors hand-tag links that must be respected, `override` to enforce one set of values, and `replace` to strip whatever came before. `replace` also drops parameters the destination needs to work — a product ID, a session token — so reach for it only when you know every link's shape.

## Recipes

**Tag your newsletter footer, but not your own site or your payment provider**

```js
autoParamAstro({
  params: { utm_source: "newsletter", utm_medium: "email" },
  skipInternalLinks: true,
  exemptDomains: ["stripe.com"],
});
```

**Tag affiliate links only, each with its own code**

```js
autoParamAstro({
  params: { utm_source: "acme" },
  includeDomains: ["partner.com", "affiliate.net"],
  domainParams: {
    "partner.com": { ref: "acme-2024" },
    "affiliate.net": { aff_id: "18823" },
  },
});
```

**Enforce your parameters everywhere, and exempt links case by case**

```js
autoParamAstro({
  params: { utm_source: "acme" },
  paramMode: "override",
});
```

```html
<a href="https://example.com/promo?utm_source=partner-run" data-auto-param-exempt>
  Keeps the partner's own tagging
</a>
```

## How it works

Links are rewritten in two places, so every route is covered:

1. **Middleware**, registered with `addMiddleware({ order: "post" })`. Handles pages rendered on demand, and prerendered pages at build time. The middleware module is generated as a Vite virtual module with your options baked in — nothing is written to disk.
2. **`astro:build:done`**, which walks the build output and rewrites every `*.html` file. This also covers static HTML copied from `public/`, which the middleware never sees.

Both passes are idempotent: a document processed twice is identical to one processed once. Options are validated when the config loads, so a typo fails immediately with a message naming the field, rather than halfway through a build.

## Good to know

**Links created by client-side JavaScript are not rewritten.** Rewriting happens on the HTML your site sends. A link that a React or Svelte island renders after hydration never passes through it. Put those parameters in the component itself.

**On-demand pages stop streaming.** Rewriting needs the whole document, so the middleware buffers the response body before sending it. Prerendered and static pages are unaffected. If a page depends on streaming, keep it prerendered or exempt it from the integration.

**Non-HTML responses pass straight through.** JSON endpoints, RSS feeds, and anything else without a `text/html` content type are untouched.

**A failed rewrite never takes a page down.** If rewriting a response throws, the middleware returns the original response untouched.

**Repeated parameters collapse under `override` and `replace`.** A link carrying `?utm_medium=social&utm_medium=ads` keeps both values under `preserve`, but comes out with a single `utm_medium` in the other two modes.

## Advanced usage

**Rewrite HTML yourself**

```ts
import { rewriteHtmlExternalLinks } from "@newgentdigital/auto-param-astro";

const { html, linksScanned, linksChanged } = rewriteHtmlExternalLinks(source, {
  params: { utm_source: "docs" },
});
```

**On-demand rewriting only, without the build pass**

```ts
// src/middleware.ts
import { createMiddleware } from "@newgentdigital/auto-param-astro/middleware";

export const onRequest = createMiddleware(
  { params: { utm_source: "acme" }, skipInternalLinks: true },
  "acme.com", // the host to treat as internal
);
```

Do not use this alongside the integration; it would register the middleware twice.
