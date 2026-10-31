// Minimal flat config for ESLint 9 + Next.js 16.
// Avoids the FlatCompat circular-reference issue that occurs when extending
// "next/core-web-vitals" via @eslint/eslintrc on these versions.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  { ignores: [".next/**", "node_modules/**", "prisma/dev.db*"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // Allow unused vars prefixed with _ (common in route handlers).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Next.js route handlers legitimately use `any` for parsed JSON bodies.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
