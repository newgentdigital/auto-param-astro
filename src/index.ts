import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroIntegration } from "astro";

import { assertValidOptions, escapeRegExp, resolveOptions } from "./options.js";
import { rewriteHtml } from "./rewrite-html.js";
import type { AutoParamAstroOptions, RewriteStats } from "./types.js";
import { findHtmlFiles } from "./walk.js";

const NAME = "@newgentdigital/auto-param-astro";

const VIRTUAL_MODULE_ID = "virtual:auto-param-astro/middleware";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

/**
 * Absolute path to this package's middleware entrypoint, as a specifier Vite
 * can import. Only Windows separators are rewritten — on POSIX a backslash is a
 * legal filename character, so replacing it would corrupt the path.
 */
const MIDDLEWARE_ENTRYPOINT = (() => {
  const filePath = fileURLToPath(new URL("./middleware.js", import.meta.url));
  return path.sep === path.win32.sep
    ? filePath.replaceAll(path.win32.sep, path.posix.sep)
    : filePath;
})();

function exactMatch(id: string): RegExp {
  return new RegExp(`^${escapeRegExp(id)}$`);
}

/** The hostname of Astro's `site` config, or `undefined` when it is unset. */
function siteHostname(site: string | undefined): string | undefined {
  if (!site) return undefined;

  try {
    return new URL(site).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Serves a generated middleware module with the user's options baked in.
 *
 * Astro resolves integration middleware entrypoints through Vite, so a virtual
 * module lets us pass build-time configuration through without writing a
 * generated file to disk. `getSiteHost` is read lazily because the module is
 * loaded well after `astro:config:done` has resolved the site.
 *
 * The hooks use Vite 8's object form with an `id` filter. Astro 7 runs on
 * Rolldown, where an unfiltered hook is invoked across the JS/Rust boundary for
 * every single module; the filter keeps that to the one module we own.
 */
function createMiddlewarePlugin(
  options: AutoParamAstroOptions,
  getSiteHost: () => string | undefined,
) {
  return {
    name: VIRTUAL_MODULE_ID,
    resolveId: {
      filter: { id: exactMatch(VIRTUAL_MODULE_ID) },
      handler: (id: string) => (id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : undefined),
    },
    load: {
      filter: { id: exactMatch(RESOLVED_VIRTUAL_MODULE_ID) },
      handler: (id: string) =>
        id === RESOLVED_VIRTUAL_MODULE_ID
          ? [
              `import { createMiddleware } from ${JSON.stringify(MIDDLEWARE_ENTRYPOINT)};`,
              `export const onRequest = createMiddleware(${JSON.stringify(options)}, ${JSON.stringify(getSiteHost())});`,
            ].join("\n")
          : undefined,
    },
  };
}

/** Runs `worker` over `items` with at most `concurrency` in flight. */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      // Sequential by design: each runner is one of `concurrency` workers
      // draining a shared cursor.
      // oxlint-disable-next-line eslint/no-await-in-loop
      if (item !== undefined) await worker(item);
    }
  });

  await Promise.all(runners);
}

/**
 * Adds query parameters to the outbound links in your site's HTML, both at build
 * time and for pages rendered on demand.
 *
 * Register it in `astro.config.mjs`. Options are validated immediately, so a
 * typo fails the config rather than the build.
 *
 * @param options - See {@link AutoParamAstroOptions}. Only `params` is required.
 * @throws If the options are unusable, with a message naming the offending field.
 *
 * @example
 * ```js
 * // astro.config.mjs
 * import autoParamAstro from "@newgentdigital/auto-param-astro";
 * import { defineConfig } from "astro/config";
 *
 * export default defineConfig({
 *   integrations: [
 *     autoParamAstro({
 *       params: { utm_source: "acme", utm_medium: "referral" },
 *       skipInternalLinks: true,
 *     }),
 *   ],
 * });
 * ```
 */
export default function autoParamAstro(options: AutoParamAstroOptions): AstroIntegration {
  // Fail fast at config time rather than mid-build.
  assertValidOptions(options);

  let siteHost: string | undefined;

  return {
    name: NAME,
    hooks: {
      "astro:config:setup": ({ addMiddleware, updateConfig }) => {
        updateConfig({
          vite: { plugins: [createMiddlewarePlugin(options, () => siteHost)] },
        });

        // Handles pages rendered on demand, plus prerendered pages at build time.
        addMiddleware({ entrypoint: VIRTUAL_MODULE_ID, order: "post" });
      },
      "astro:config:done": ({ config, logger }) => {
        siteHost = siteHostname(config.site);

        if (options.skipInternalLinks && !siteHost)
          logger.warn(
            "skipInternalLinks needs `site` set in your Astro config. Until it is, links to your own domain are treated as external.",
          );
      },
      "astro:build:done": async ({ dir, logger }) => {
        const startedAt = performance.now();
        const outDir = fileURLToPath(dir);
        const resolved = resolveOptions(options, siteHost);

        // Covers static assets the middleware never sees, such as raw HTML
        // files copied from `public/`.
        const htmlFiles = await findHtmlFiles(outDir);
        if (htmlFiles.length === 0) {
          logger.debug(`No HTML files found in ${outDir}; nothing to rewrite.`);
          return;
        }

        const stats: RewriteStats = {
          filesChanged: 0,
          linksScanned: 0,
          linksChanged: 0,
        };

        const concurrency = Math.max(2, Math.min(8, availableParallelism()));

        await runPool(htmlFiles, concurrency, async (filePath) => {
          const input = await readFile(filePath, "utf8");
          const { html: output, linksScanned, linksChanged } = rewriteHtml(input, resolved);

          stats.linksScanned += linksScanned;
          stats.linksChanged += linksChanged;

          if (output === input) return;

          stats.filesChanged++;
          await writeFile(filePath, output, "utf8");
        });

        const elapsedMs = Math.round(performance.now() - startedAt);
        const summary = `Added parameters to ${stats.linksChanged} of ${stats.linksScanned} links in ${stats.filesChanged} of ${htmlFiles.length} HTML files (${elapsedMs}ms).`;

        // A build that changed nothing is either correct or misconfigured, and
        // the log line cannot tell which; keep it out of the default output.
        if (stats.linksChanged === 0) logger.debug(summary);
        else logger.info(summary);
      },
    },
  };
}

export { rewriteHtmlExternalLinks } from "./rewrite-html.js";
export type { HtmlRewriteResult } from "./rewrite-html.js";
export type {
  AutoParamAstroOptions,
  AutoParamMap,
  AutoParamParamMode,
  AutoParamValue,
} from "./types.js";
