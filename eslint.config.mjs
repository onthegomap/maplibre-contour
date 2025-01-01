import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  prettier,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-dupe-class-members": ["error"],

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-useless-constructor": ["error"],
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
