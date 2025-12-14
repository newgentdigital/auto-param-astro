![Repository banner for @newgentdigital/auto-param-astro](https://raw.githubusercontent.com/newgentdigital/.github/refs/heads/main/banner.png)

# @newgentdigital/auto-param-astro

Astro integration that adds configured query parameters to **external links** at **build time**.

## Install

```bash
bun add @newgentdigital/auto-param-astro
# or
npm i @newgentdigital/auto-param-astro
```

## Usage

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import autoParamAstro from "@newgentdigital/auto-param-astro";

export default defineConfig({
  integrations: [
    autoParamAstro({
      params: {
        utm_source: "newsletter",
        utm_medium: "email",
      },
      paramMode: "replace",
      exemptDataAttributes: ["data-auto-param-exempt"],
      exemptDomains: ["example.com", "*.github.com"],
    }),
  ],
});
```

## How the integration works

- Runs during the `astro:build:done` hook.
- Walks the build output directory and rewrites `*.html` files.
- Updates `<a href="https://...">` links (and protocol-relative `//...`) by inserting/updating `params`.
- Skips links that:
  - have any configured `exemptDataAttributes` present on the `<a>` tag
  - point to a host in `exemptDomains` (exact match or subdomain match; also supports leading-wildcard `*.example.com`)

## Options

### Required settings

- `params`: `Record<string, string | number | boolean>`

### Optional settings

- `paramMode`: `"preserve" | "override" | "replace"`
  - Default: `"preserve"`
  - `preserve` (a): keep existing URL params, only add missing configured params
  - `override` (b): keep existing URL params, but overwrite values for configured keys
  - `replace` (c): remove all existing URL params and add only configured params
- `exemptDataAttributes`: `string[]`
  - Default: `["data-auto-param-exempt"]`
- `exemptDomains`: `string[]`
  - Default: `[]`

## Explanation of `paramMode`

Assume you have the following integration config:

```js
// astro.config.mjs
autoParamAstro({
  params: {
    utm_source: "newsletter",
    utm_medium: "email",
    utm_term: "winter",
    ref: true,
    v: 2,
  },
});
```

... and this incoming link in your code:

```text
https://example.com/pricing?utm_source=twitter&utm_medium=social&utm_medium=ads&utm_campaign=sale#faq
```

What result the integration generates depends on your `paramMode`:

- `preserve` (default)
  - Keeps existing values for any configured parameters that already exist.
  - Only adds configured parameters that are missing.
  - Result: `https://example.com/pricing?utm_source=twitter&utm_medium=social&utm_medium=ads&utm_campaign=sale&utm_term=winter&ref=true&v=2#faq`

- `override`
  - Overwrites configured parameters (and collapses duplicates for those parameters to a single value).
  - Leaves non-configured parameters (like `utm_campaign`) alone.
  - Result: `https://example.com/pricing?utm_source=newsletter&utm_medium=email&utm_campaign=sale&utm_term=winter&ref=true&v=2#faq`

- `replace`
  - Drops _all_ existing query parameters, then adds only configured ones.
  - Keeps the path and hash.
  - Result: `https://example.com/pricing?utm_source=newsletter&utm_medium=email&utm_term=winter&ref=true&v=2#faq`

## Exempt a single link

A link with the default attribute `data-auto-param-exempt` or one of the configured `exemptDataAttributes` will prevent the integration from updating the href for that link.

```html
<a href="https://example.com" data-auto-param-exempt>
  This link will not be modified.
</a>
```
