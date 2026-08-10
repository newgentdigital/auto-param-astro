import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";
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
 * Invokes `astro:config:setup` with just enough of a stub to capture what the
 * integration registers.
 */
function setup(
  integration: AstroIntegration,
  overrides: { addMiddleware?: (mid: unknown) => void } = {},
): { plugins: VitePlugin[] } {
  const plugins: VitePlugin[] = [];

  const hook = integration.hooks["astro:config:setup"];
  if (!hook) throw new Error("astro:config:setup hook is missing");

  void (hook as NonNullable<Hooks["astro:config:setup"]>)({
    addMiddleware: overrides.addMiddleware ?? (() => undefined),
    updateConfig: (config: { vite?: { plugins?: VitePlugin[] } }) => {
      plugins.push(...(config.vite?.plugins ?? []));
      return config;
    },
  } as never);

  return { plugins };
}

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  options: {} as never,
  label: "test",
  fork: () => noopLogger,
};

async function createFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "auto-param-"));
  await mkdir(path.join(dir, "nested", "deep"), { recursive: true });

  await writeFile(path.join(dir, "index.html"), `<a href="https://example.com/">root</a>`);
  await writeFile(
    path.join(dir, "nested", "deep", "page.html"),
    `<a href="https://example.com/">nested</a>`,
  );
  await writeFile(path.join(dir, "skip.txt"), `<a href="https://example.com/">`);

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

  test("registers the middleware entrypoint and vite plugin", () => {
    const middlewares: unknown[] = [];
    const { plugins } = setup(autoParamAstro({ params: { utm_source: "n" } }), {
      addMiddleware: (mid) => middlewares.push(mid),
    });

    expect(middlewares).toEqual([{ entrypoint: VIRTUAL_ID, order: "post" }]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe(VIRTUAL_ID);
  });

  test("the virtual module resolves and embeds the configured options", () => {
    const { plugins } = setup(
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
    expect(code).toContain(`"paramMode":"override"`);
    expect(code).toContain("middleware.js");
  });

  test("rewrites every HTML file in the build output", async () => {
    const dir = await createFixture();
    const integration = autoParamAstro({
      params: { utm_source: "newsletter" },
    });

    await (integration.hooks["astro:build:done"] as NonNullable<Hooks["astro:build:done"]>)({
      dir: pathToFileURL(`${dir}/`),
      logger: noopLogger,
      pages: [],
      assets: new Map(),
    } as never);

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

    await expect(
      (integration.hooks["astro:build:done"] as NonNullable<Hooks["astro:build:done"]>)({
        dir: pathToFileURL(`${dir}/`),
        logger: noopLogger,
        pages: [],
        assets: new Map(),
      } as never),
    ).resolves.toBeUndefined();
  });
});
