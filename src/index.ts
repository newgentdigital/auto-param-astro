import { readFile, writeFile } from "fs/promises";
import { cpus } from "os";
import path from "path";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";
import type { AstroIntegration } from "astro";
import { rewriteHtmlExternalLinks } from "./rewrite-html.js";
import type { AutoParamAstroOptions, RewriteStats } from "./types.js";
import { walkFiles } from "./walk.js";

function assertValidOptions(options: AutoParamAstroOptions): void {
  if (!options || typeof options !== "object") {
    throw new Error("[auto-param-astro] Options are required.");
  }

  if (!options.params || typeof options.params !== "object") {
    throw new Error("[auto-param-astro] options.params must be an object.");
  }

  if (Object.keys(options.params).length === 0) {
    throw new Error(
      "[auto-param-astro] options.params must contain at least one parameter.",
    );
  }

  if (
    options.paramMode &&
    options.paramMode !== "preserve" &&
    options.paramMode !== "override" &&
    options.paramMode !== "replace"
  ) {
    throw new Error(
      "[auto-param-astro] options.paramMode must be one of: preserve | override | replace.",
    );
  }
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const runners = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default function autoParamAstro(
  options: AutoParamAstroOptions,
): AstroIntegration {
  assertValidOptions(options);

  return {
    name: "@newgentdigital/auto-param-astro",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const startedAt = performance.now();
        const outDir = fileURLToPath(dir);

        const stats: RewriteStats = {
          filesScanned: 0,
          filesChanged: 0,
          linksScanned: 0,
          linksChanged: 0,
        };

        const htmlFiles: string[] = [];
        for await (const filePath of walkFiles(outDir)) {
          stats.filesScanned++;
          if (filePath.toLowerCase().endsWith(".html"))
            htmlFiles.push(filePath);
        }

        const concurrency = Math.max(2, Math.min(8, cpus().length || 2));
        const buildLogger = logger.fork(
          "@newgentdigital/auto-param-astro/build",
        );

        await runPool(htmlFiles, concurrency, async (filePath) => {
          const input = await readFile(filePath, "utf8");
          const {
            html: output,
            linksScanned,
            linksChanged,
          } = rewriteHtmlExternalLinks(input, options);

          stats.linksScanned += linksScanned;
          stats.linksChanged += linksChanged;

          if (output !== input) {
            stats.filesChanged++;
            await writeFile(filePath, output, "utf8");
          }
        });

        const elapsedMs = Math.round(performance.now() - startedAt);
        buildLogger.info(
          `Updated ${stats.linksChanged}/${stats.linksScanned} external links across ${stats.filesChanged}/${htmlFiles.length} HTML files in ${elapsedMs}ms (outDir: ${path.basename(outDir)}).`,
        );
      },
    },
  };
}

export type { AutoParamAstroOptions } from "./types.js";
