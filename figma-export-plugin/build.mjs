import { build, context } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });

const codeOpts = {
  entryPoints: ["src/code.ts"],
  bundle: true,
  outfile: "dist/code.js",
  target: "es2020",
  format: "iife",
};

const uiOpts = {
  entryPoints: ["src/ui.ts"],
  bundle: true,
  outfile: "dist/ui.bundle.js",
  target: "es2020",
  format: "iife",
};

function writeUiHtml() {
  const template = readFileSync("src/ui.template.html", "utf8");
  const script = readFileSync("dist/ui.bundle.js", "utf8");
  writeFileSync("dist/ui.html", template.replace("__SCRIPT__", script));
}

if (watch) {
  const codeCtx = await context(codeOpts);
  const uiCtx = await context({
    ...uiOpts,
    plugins: [
      {
        name: "write-html",
        setup(b) {
          b.onEnd(() => writeUiHtml());
        },
      },
    ],
  });
  await codeCtx.watch();
  await uiCtx.watch();
  console.log("Watching figma-export-plugin/src for changes...");
} else {
  await build(codeOpts);
  await build(uiOpts);
  writeUiHtml();
  console.log("Build completata: figma-export-plugin/dist/code.js, figma-export-plugin/dist/ui.html");
}
