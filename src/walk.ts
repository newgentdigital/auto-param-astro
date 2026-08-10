import { readdir } from "node:fs/promises";
import path from "node:path";

/** Recursively collects the absolute paths of every `*.html` file in `rootDir`. */
export async function findHtmlFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, {
    recursive: true,
    withFileTypes: true,
  });

  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".html")) continue;

    // `parentPath` is available from Node 20.12, which this package requires.
    files.push(path.join(entry.parentPath, entry.name));
  }

  return files;
}
