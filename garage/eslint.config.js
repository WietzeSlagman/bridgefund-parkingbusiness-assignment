import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "migrations/**"] },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      importPlugin.flatConfigs.errors,
      importPlugin.flatConfigs.warnings,
      importPlugin.flatConfigs.typescript,
    ],
    languageOptions: {
      parserOptions: { project: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
  },
  prettier,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      curly: ["warn", "all"],
      "import/no-cycle": "error",
      "import/no-default-export": "error",
      "import/no-unresolved": "off",
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-param-reassign": "error",
      "no-unneeded-ternary": "error",
    },
  },
  // Drizzle Kit requires a default-exported configuration.
  {
    files: ["drizzle.config.ts"],
    rules: { "import/no-default-export": "off" },
  },
);
