import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  outfile: "www/js/app.js",
  define: {
    __API_BASE__: JSON.stringify(process.env.API_BASE || ""),
  },
});
