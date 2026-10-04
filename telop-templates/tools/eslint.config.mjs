// After Effects の ExtendScript は ES3 相当。構文と、ES5 以降にしか無いメソッドの混入をここで弾く。
//   npx eslint -c tools/eslint.config.mjs TelopTemplates.jsx
const es5Methods = ["forEach", "map", "filter", "reduce", "some", "every", "indexOf", "lastIndexOf", "trim", "keys", "bind", "isArray"];

export default [
  {
    files: ["**/*.jsx"],
    languageOptions: {
      ecmaVersion: 3,
      sourceType: "script",
      globals: {
        app: "readonly",
        alert: "readonly",
        File: "readonly",
        Folder: "readonly",
        Shape: "readonly",
        MarkerValue: "readonly",
        ParagraphJustification: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      "no-redeclare": "error",
      "no-restricted-globals": ["error", "JSON", "Promise", "Map", "Set", "Symbol"],
      "no-restricted-properties": ["error", ...es5Methods.map((property) => ({ property, message: "ES5+ method; not available in ExtendScript" }))],
    },
  },
];
