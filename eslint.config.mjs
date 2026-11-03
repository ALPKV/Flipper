import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", ".next-*/**", "node_modules/**", "legacy/**", "public/vendor/**", ".venv/**", ".data/**", ".tools/**", ".pose-tools/**", ".scratch/**", "highlights/**", "videos/**", "next-env.d.ts"] },
];

export default config;
