import { spawnSync } from "node:child_process";
const args =
  process.env.TCF_BUILD_TARGET === "sites"
    ? ["scripts/run-framework.mjs", "build"]
    : ["node_modules/next/dist/bin/next", "build"];
const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
