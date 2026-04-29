import type { Config } from 'tailwindcss';

// Tailwind v4 uses CSS-first config (see globals.css @theme directive).
// This file exists for tooling compatibility (ESLint, IDE integrations) and
// to declare the content paths.
const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {},
  plugins: [],
};

export default config;
