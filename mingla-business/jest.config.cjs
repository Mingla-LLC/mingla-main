module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: { jsx: "react-native" } }],
  },
};
