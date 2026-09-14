import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const sha = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VITE_VERCEL_GIT_COMMIT_SHA ||
  process.env.DEPLOY_SHA ||
  execSync("git rev-parse HEAD", { encoding: "utf8" })
).trim();

mkdirSync("public", { recursive: true });
writeFileSync("public/version", `${sha}\n`);
mkdirSync("public/tests", { recursive: true });
copyFileSync("tests/scoring.node.test.ts", "public/tests/scoring.node.test.ts");
console.log(`wrote public/version ${sha}`);
