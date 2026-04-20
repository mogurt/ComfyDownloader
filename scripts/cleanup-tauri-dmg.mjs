import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetDir = resolve(__dirname, "..", "src-tauri", "target");
const staleDmgPattern = /^rw\..+\.dmg$/;

async function removeStaleDmgFiles(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !staleDmgPattern.test(entry.name)) {
      continue;
    }

    const fullPath = join(directory, entry.name);
    await rm(fullPath, { force: true });
    console.log(`[cleanup-tauri-dmg] Removed stale DMG: ${fullPath}`);
  }
}

async function main() {
  let profiles;

  try {
    profiles = await readdir(targetDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const profile of profiles) {
    if (!profile.isDirectory()) {
      continue;
    }

    await removeStaleDmgFiles(join(targetDir, profile.name, "bundle", "macos"));
    await removeStaleDmgFiles(join(targetDir, profile.name, "bundle", "dmg"));
  }
}

main().catch((error) => {
  console.error("[cleanup-tauri-dmg] Failed to clean stale DMG files.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
