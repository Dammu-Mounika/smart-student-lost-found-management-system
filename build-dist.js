import fs from "fs";
import path from "path";

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const items = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const item of items) {
    const src = path.join(sourceDir, item.name);
    const dest = path.join(targetDir, item.name);

    if (item.isDirectory()) {
      copyDirectory(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

const frontendDir = path.resolve("frontend");
const distDir = path.resolve("dist");

if (fs.existsSync(frontendDir)) {
  // 1. Copy into dist/ so Vercel serves the actual pages from root of dist
  copyDirectory(frontendDir, distDir);

  // 2. Also preserve dist/frontend/* for /frontend/ links
  const distFrontendDir = path.join(distDir, "frontend");
  copyDirectory(frontendDir, distFrontendDir);

  // 3. Mirror css and js to root for zero-config static servers
  copyDirectory(path.join(frontendDir, "css"), path.resolve("css"));
  copyDirectory(path.join(frontendDir, "js"), path.resolve("js"));

  console.log("Successfully prepared frontend files in dist/ and root for production & Vercel.");
} else {
  console.warn("frontend directory not found, skipping copy.");
}
