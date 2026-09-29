import { build } from "esbuild";
await build({
  entryPoints: ["src/editor.js"],
  outfile: "src/generated/editor.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome140",
  sourcemap: true,
});
