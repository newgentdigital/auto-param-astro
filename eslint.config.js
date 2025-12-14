import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["node_modules/"],
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [tseslint.configs.strict, tseslint.configs.stylistic],
  },

  {
    files: ["**/*.js", "**/*.jsx"],
    extends: [eslint.configs.recommended],
  },
]);
