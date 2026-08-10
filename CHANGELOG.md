# Changelog

## [2.0.0](https://github.com/newgentdigital/auto-param-astro/compare/v1.3.0...v2.0.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* the astro peer dependency is now ^7.2.0 and Node >=22.12.0 is required. Astro 6 dropped Node 18 and 20, and Astro 7 moved to Vite 8 (Rolldown), which changes the Vite internals an integration plugin builds against. Projects on Astro 5 or 6 should stay on 1.x.

### Features

* require Astro 7 and Node 22.12 ([29cbecc](https://github.com/newgentdigital/auto-param-astro/commit/29cbeccac88a25e3050951f2f538dce08a23da7a))


### Bug Fixes

* decode HTML entities in one pass and bound hostname normalisation ([e7505e6](https://github.com/newgentdigital/auto-param-astro/commit/e7505e6b2bfe233baa2c8b340ba14fcb94f9605a))
* **middleware:** keep rewritten responses valid ([eb6f060](https://github.com/newgentdigital/auto-param-astro/commit/eb6f060afc0fc69feb745a9f0d82632018ecd4a9))
* stop rewriting markup that is not an external link ([2b75f10](https://github.com/newgentdigital/auto-param-astro/commit/2b75f1081449ea01a0cbda72b8302fe89b076fcc))

## [1.3.0](https://github.com/newgentdigital/auto-param-astro/compare/v1.2.0...v1.3.0) (2026-01-26)

### Features

- implement dynamic middleware for HTML response rewriting ([63d53c4](https://github.com/newgentdigital/auto-param-astro/commit/63d53c4999587df30d795d8ff320d752821fc9d1))

## [1.2.0](https://github.com/newgentdigital/auto-param-astro/compare/v1.1.1...v1.2.0) (2026-01-26)

### Features

- add dev mode support ([ce70499](https://github.com/newgentdigital/auto-param-astro/commit/ce70499f19ae2444868738b2a1d6d4e0673f80ac))

## [1.1.1](https://github.com/newgentdigital/auto-param-astro/compare/v1.1.0...v1.1.1) (2025-12-14)

### Miscellaneous Chores

- remove unused id from release-please workflow ([4dc4637](https://github.com/newgentdigital/auto-param-astro/commit/4dc46373e435da355746a60e7ae3276027bf96ff))

## [1.1.0](https://github.com/newgentdigital/auto-param-astro/compare/v1.0.2...v1.1.0) (2025-12-14)

### Features

- add GitHub Actions workflow for publishing to npm and GitHub Packages ([bc9a328](https://github.com/newgentdigital/auto-param-astro/commit/bc9a3283e06cac88be2fefdcf6093bfedf0fadf4))
- initial version of integration ([af11286](https://github.com/newgentdigital/auto-param-astro/commit/af11286e24ca8abe843567fc4e24b76c5c26ebe2))
- rename workflow to 'Prepare release with release-please' and remove unused parameters ([4f10df4](https://github.com/newgentdigital/auto-param-astro/commit/4f10df4b8c33fea403764fa2ea29461cc19dae42))
- update version to 1.0.1 and add LICENSE file ([1343232](https://github.com/newgentdigital/auto-param-astro/commit/13432328bf415eb6f595d0fcbed9653f13e2be19))
- use Trusted Published for npm publishing ([cff54cb](https://github.com/newgentdigital/auto-param-astro/commit/cff54cb359309939751ae6a64dab19901c230bb1))

### Bug Fixes

- correct package name and repository URL format in package.json ([becec2a](https://github.com/newgentdigital/auto-param-astro/commit/becec2afa6f477f30c2124fb6601fede4eff226c))
- refactor loop in rewriteHtmlExternalLinks to avoid constant-condition ([64b248c](https://github.com/newgentdigital/auto-param-astro/commit/64b248c2b30c45a502754c2665c2480be0264fff))
- update keywords in package.json for better relevance ([f9de859](https://github.com/newgentdigital/auto-param-astro/commit/f9de859961ada341ba600716acad61a560cde328))
