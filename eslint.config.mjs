// Lint (`npx eslint`): mistakes found without running the code. Undefined
// names, unused variables and imports, unreachable code, duplicate keys.
// `npm run lint` (with ruff), run by `npm run check`, CI and the git hook
// (scripts/git-hooks/pre-commit).
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      // Vendored bundles.
      "custom_components/yeelight_cube/www/lib/**",
      "custom_components/yeelight_cube/www/sortable.min.js",
      ".claude/**",
      "node_modules/**",
      "archive/**",
      "dev-cards/**",
      "tests/_tmp/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      // An unused argument documents a callback's shape; `_name` marks one
      // left unused on purpose.
      "no-unused-vars": [
        "error",
        {
          args: "none",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          // const { dropped, ...rest } = object: leaving keys out.
          ignoreRestSiblings: true,
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Style only: `case` bodies declaring their own names, and a regular
      // expression's spaces written out (the tests' source checks).
      "no-case-declarations": "off",
      "no-regex-spaces": "off",
    },
  },
  // The cards: ES modules in the browser.
  {
    files: ["custom_components/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.browser },
  },
  // Node: the tests, scripts and tools.
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module", globals: globals.node },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  // The browser checks: code run in the page too (page.evaluate), with the
  // names the test page defines (card, hass, mount, calls...): no undefined
  // names check there.
  {
    files: ["tests/**/*.cjs", "tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-undef": "off" },
  },
];
