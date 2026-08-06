import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild, context as esbuildContext } from "esbuild";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  const buildOptions = {
    entryPoints: [
      path.resolve(__dirname, "src/index.ts"),
      path.resolve(__dirname, "src/seed.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    external: [
      "*.node",
      "pg-native",
      "bufferutil",
      "utf-8-validate",
      "sharp",
      "bcrypt",
      "argon2",
      "fsevents",
    ],
    sourcemap: "linked",
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
    },
  };

  const isWatch = process.argv.includes("--watch");
  if (isWatch) {
    const ctx = await esbuildContext(buildOptions);
    await ctx.watch();
    console.log("⚡ Watching for changes in src/...");
  } else {
    await esbuild(buildOptions);
  }

  // Copy email templates directory to dist/templates
  const templatesSrc = path.resolve(__dirname, "src/templates");
  const templatesDist = path.resolve(distDir, "templates");
  try {
    const { cp } = await import("node:fs/promises");
    await cp(templatesSrc, templatesDist, { recursive: true });
  } catch {
    // Ignore if templates directory does not exist
  }
}


buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
