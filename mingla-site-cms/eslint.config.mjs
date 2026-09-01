import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([...nextVitals, ...nextTypescript, globalIgnores([".next/**", "src/app/(payload)/admin/importMap.ts", "src/migrations/**", "next-env.d.ts"])]);
