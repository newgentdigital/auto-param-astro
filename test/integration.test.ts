import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AstroIntegration } from "astro";

import autoParamAstro from "../src/index.js";
import { findHtmlFiles } from "../src/walk.js";

type Hooks = AstroIntegration["hooks"];

const VIRTUAL_ID = "virtual:auto-param-astro/middleware";
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

interface FilteredHook<T> {
  filter: { id: RegExp };
  handler: (id: string) => T;
}

interface VitePlugin {
  name: string;
  resolveId: FilteredHook<string | undefined>;
  load: FilteredHook<string | undefined>;
}

/**
 * Invokes "astro:config:setup" with just enough of a stub to capture what the
 * integration registers.
 */
async function setup(
  integration: AstroIntegration,
  overrides: { addMiddleware?: (mid: unknown) => void } = {},
): Promise<{ plugins: VitePlugin[] }> {
  const plugins: VitePlugin[] = [];

  const hook = integration.hooks["astro:config:setup"];
  if (!hook) throw new Error("astro:config:setup hook is missing");

  // The hook may return void or a promise; await covers both.
  await (hook as NonNullable<Hooks["astro:config:setup"]>)({
    addMiddleware: overrides.addMiddleware ?? (() => undefined),
    updateConfig: (config: { vite?: { plugins?: VitePlugin[] } }) => {
      plugins.push(...(config.vite?.plugins ?? []));
      return config;
    },
  } as never);

  return { plugins };
}

interface RecordingLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
  messages: { level: string; message: string }[];
  options: never;
  label: string;
  fork: () => RecordingLogger;
}

/** A logger that records what the integration reported, for assertions. */
function createLogger(): RecordingLogger {
  const messages: { level: string; message: string }[] = [];
  const record = (level: string) => (message: string) => void messages.push({ level, message });

  const logger: RecordingLogger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    debug: record("debug"),
    messages,
    options: {} as never,
    label: "test",
    fork: () => logger,
  };

  return logger;
}

/** Invokes "astro:config:done" with a stub config, as Astro does after setup. */
async function configDone(
  integration: AstroIntegration,
  site: string | undefined,
  logger: RecordingLogger = createLogger(),
): Promise<RecordingLogger> {
  const hook = integration.hooks["astro:config:done"];
  if (!hook) throw new Error("astro:config:done hook is missing");

  await (hook as NonNullable<Hooks["astro:config:done"]>)({
    config: { site },
    logger,
  } as never);

  return logger;
}

/** Invokes "astro:build:done" against a directory of built HTML. */
async function buildDone(
  integration: AstroIntegration,
  dir: string,
  logger: RecordingLogger = createLogger(),
): Promise<RecordingLogger> {
  const hook = integration.hooks["astro:build:done"];
  if (!hook) throw new Error("astro:build:done hook is missing");

  await (hook as NonNullable<Hooks["astro:build:done"]>)({
    dir: pathToFileURL(`${dir}/`),
    logger,
    pages: [],
    assets: new Map(),
  } as never);

  return logger;
}

async function createFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "auto-param-"));
  await mkdir(path.join(dir, "nested", "deep"), { recursive: true });

  await writeFile(path.join(dir, "index.html"), '<a href="https://example.com/">root</a>');
  await writeFile(
    path.join(dir, "nested", "deep", "page.html"),
    '<a href="https://example.com/">nested</a>',
  );
  await writeFile(path.join(dir, "skip.txt"), '<a href="https://example.com/">');

  return dir;
}

describe("findHtmlFiles", () => {
  test("finds nested HTML files and ignores other extensions", async () => {
    const dir = await createFixture();
    const files = await findHtmlFiles(dir);

    expect(files).toHaveLength(2);
    expect(files.every((file) => path.isAbsolute(file))).toBe(true);
    expect(files.some((file) => file.endsWith("page.html"))).toBe(true);
    expect(files.some((file) => file.endsWith(".txt"))).toBe(false);
  });
});

describe("autoParamAstro", () => {
  test("validates options eagerly", () => {
    expect(() => autoParamAstro({ params: {} } as never)).toThrow(/at least one parameter/);
  });

  test("registers the middleware entrypoint and vite plugin", async () => {
    const middlewares: unknown[] = [];
    const { plugins } = await setup(autoParamAstro({ params: { utm_source: "n" } }), {
      addMiddleware: (mid) => middlewares.push(mid),
    });

    expect(middlewares).toEqual([{ entrypoint: VIRTUAL_ID, order: "post" }]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe(VIRTUAL_ID);
  });

  test("the virtual module resolves and embeds the configured options", async () => {
    const { plugins } = await setup(
      autoParamAstro({
        params: { utm_source: "n" },
        paramMode: "override",
      }),
    );
    expect(plugins).toHaveLength(1);
    const [plugin] = plugins as [VitePlugin];

    // The filters must match only our own ids, since Rolldown uses them to
    // decide whether the handler is called at all.
    expect(plugin.resolveId.filter.id.test(VIRTUAL_ID)).toBe(true);
    expect(plugin.resolveId.filter.id.test(`${VIRTUAL_ID}/extra`)).toBe(false);
    expect(plugin.load.filter.id.test(RESOLVED_VIRTUAL_ID)).toBe(true);
    expect(plugin.load.filter.id.test(VIRTUAL_ID)).toBe(false);

    expect(plugin.resolveId.handler(VIRTUAL_ID)).toBe(RESOLVED_VIRTUAL_ID);
    expect(plugin.resolveId.handler("some/other/id")).toBeUndefined();
    expect(plugin.load.handler("some/other/id")).toBeUndefined();

    const code = plugin.load.handler(RESOLVED_VIRTUAL_ID) ?? "";
    expect(code).toContain("createMiddleware");
    expect(code).toContain('"paramMode":"override"');
    expect(code).toContain("middleware.js");
  });

  test("bakes the site host into the virtual module once the config is resolved", async () => {
    const integration = autoParamAstro({
      params: { utm_source: "n" },
      skipInternalLinks: true,
    });
    const { plugins } = await setup(integration);
    const [plugin] = plugins as [VitePlugin];

    // The module is loaded after "astro:config:done", so the host must be read
    // lazily rather than captured when the plugin was created.
    await configDone(integration, "https://acme.com/blog");

    expect(plugin.load.handler(RESOLVED_VIRTUAL_ID) ?? "").toContain('"acme.com"');
  });

  test("warns when skipInternalLinks has no site to work from", async () => {
    const integration = autoParamAstro({
      params: { utm_source: "n" },
      skipInternalLinks: true,
    });
    await setup(integration);

    const logger = await configDone(integration, undefined);
    expect(logger.messages).toEqual([
      { level: "warn", message: expect.stringContaining("skipInternalLinks") },
    ]);
  });

  test("warns when site is not a parseable URL", async () => {
    const integration = autoParamAstro({
      params: { utm_source: "n" },
      skipInternalLinks: true,
    });
    await setup(integration);

    const logger = await configDone(integration, "not a url");
    expect(logger.messages.map((entry) => entry.level)).toEqual(["warn"]);
  });

  test("stays quiet about the site when skipInternalLinks is off", async () => {
    const integration = autoParamAstro({ params: { utm_source: "n" } });
    await setup(integration);

    const logger = await configDone(integration, undefined);
    expect(logger.messages).toEqual([]);
  });

  test("skips links to the site's own host in the build output", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "auto-param-internal-"));
    await writeFile(
      path.join(dir, "index.html"),
      '<a href="https://acme.com/about">in</a><a href="https://other.com/">out</a>',
    );

    const integration = autoParamAstro({
      params: { utm_source: "n" },
      skipInternalLinks: true,
    });
    await setup(integration);
    await configDone(integration, "https://acme.com");
    await buildDone(integration, dir);

    const html = await readFile(path.join(dir, "index.html"), "utf8");
    expect(html).toBe(
      '<a href="https://acme.com/about">in</a><a href="https://other.com/?utm_source=n">out</a>',
    );
  });

  test("reports what it changed at info level, and silence at debug level", async () => {
    const dir = await createFixture();
    const changed = await buildDone(autoParamAstro({ params: { utm_source: "n" } }), dir);
    expect(changed.messages).toEqual([
      { level: "info", message: expect.stringContaining("Added parameters to 2 of 2 links") },
    ]);

    // Nothing left to change: the same pass a second time is not news.
    const unchanged = await buildDone(autoParamAstro({ params: { utm_source: "n" } }), dir);
    expect(unchanged.messages.map((entry) => entry.level)).toEqual(["debug"]);
  });

  test("rewrites every HTML file in the build output", async () => {
    const dir = await createFixture();
    const integration = autoParamAstro({
      params: { utm_source: "newsletter" },
    });

    await buildDone(integration, dir);

    const root = await readFile(path.join(dir, "index.html"), "utf8");
    const nested = await readFile(path.join(dir, "nested", "deep", "page.html"), "utf8");
    const untouched = await readFile(path.join(dir, "skip.txt"), "utf8");

    expect(root).toContain("utm_source=newsletter");
    expect(nested).toContain("utm_source=newsletter");
    expect(untouched).not.toContain("utm_source");
  });

  test("handles an empty output directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "auto-param-empty-"));
    const integration = autoParamAstro({ params: { utm_source: "n" } });

    const logger = await buildDone(integration, dir);
    expect(logger.messages.map((entry) => entry.level)).toEqual(["debug"]);
  });
});
