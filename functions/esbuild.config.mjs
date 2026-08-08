import { resolve } from "node:path";
import { build } from "esbuild";

const sharedSource = resolve("../packages/shared/src/index.ts");

await build({
  entryPoints: ["src/index.ts", "src/validate-voices.ts"],
  outdir: "dist",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  plugins: [{
    name: "bundle-shared-contracts",
    setup(context) {
      context.onResolve({ filter: /^@resolingo\/shared$/ }, () => ({ path: sharedSource }));
    },
  }],
});
