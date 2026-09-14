import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const sha = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VITE_VERCEL_GIT_COMMIT_SHA ||
  process.env.DEPLOY_SHA ||
  execSync("git rev-parse HEAD", { encoding: "utf8" })
).trim();

mkdirSync("public", { recursive: true });
writeFileSync("public/version", `${sha}\n`);
console.log(`wrote public/version ${sha}`);
