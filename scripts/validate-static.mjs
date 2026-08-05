import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");

for (const relativePath of ["public/index.html", "public/portal.html"]) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  if (!source.includes("<!doctype html>") || !source.includes("</html>")) {
    throw new Error(`${relativePath} is not a complete HTML document`);
  }

  const inlineScripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const [index, match] of inlineScripts.entries()) {
    try {
      // Compile only; browser APIs are intentionally not executed during build.
      new Function(match[1]);
    } catch (error) {
      throw new Error(`${relativePath} inline script ${index + 1} is invalid: ${error.message}`);
    }
  }
}

console.log("Static pages validated.");
