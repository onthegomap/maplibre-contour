/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  transform: {
    // use typescript to convert from esm to cjs
    "[.](m|c)?(ts|js)(x)?$": [
      "ts-jest",
      {
        isolatedModules: true,
      },
    ],
    "^.+\\.js$": "babel-jest",
  },
  testEnvironment: "jsdom",
  setupFiles: ["<rootDir>/src/setup-jest.ts"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,js}"],
  transformIgnorePatterns: ["!<rootDir>/node_modules/"],
};
