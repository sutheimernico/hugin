// Copies the committed demo recordings next to the replay-only build and writes the index the
// shell reads in place of `GET /api/recordings`. Run after `vite build --outDir dist-pages`.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const from = join(root, "demo", "recordings");
const to = join(root, "frontend", "dist-pages", "recordings");
mkdirSync(to, { recursive: true });

const manifests = [];
for (const name of readdirSync(from).sort()) {
  if (name.endsWith(".jsonl")) copyFileSync(join(from, name), join(to, name));
  if (name.endsWith(".json")) manifests.push(JSON.parse(readFileSync(join(from, name), "utf8")));
}
writeFileSync(join(to, "index.json"), JSON.stringify(manifests));
console.log(`pages: ${manifests.length} recordings -> ${to}`);
