import { opendir } from "fs/promises";
import path from "path";

export async function* walkFiles(rootDir: string): AsyncGenerator<string> {
  const dir = await opendir(rootDir);
  for await (const entry of dir) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }
    if (entry.isFile()) yield fullPath;
  }
}
