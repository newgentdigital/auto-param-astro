import { readdir } from "fs/promises";
import path from "path";

export async function* walkFiles(rootDir: string): AsyncGenerator<string> {
  const files = await readdir(rootDir, {
    recursive: true,
    withFileTypes: true,
  });

  for (const file of files) {
    if (file.isFile() && file.name.toLowerCase().endsWith(".html")) {
      const filePath = file.parentPath
        ? path.join(file.parentPath, file.name)
        : path.join(rootDir, file.name);
      yield filePath;
    }
  }
}
