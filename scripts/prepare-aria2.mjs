import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");
const targetBinary = join(
  binariesDir,
  "aria2c-x86_64-pc-windows-msvc.exe",
);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "comfy-downloader-setup",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "comfy-downloader-setup",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

function runPowerShellExpandArchive(zipPath, destinationDir) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destinationDir.replaceAll("'", "''")}' -Force`,
      ],
      {
        stdio: "inherit",
      },
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Expand-Archive failed with exit code ${code}`));
    });

    child.on("error", rejectPromise);
  });
}

async function findFileRecursive(rootDir, fileName) {
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const match = await findFileRecursive(fullPath, fileName);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

async function getLatestAria2Version() {
  const release = await fetchJson("https://api.github.com/repos/aria2/aria2/releases/latest");
  const tagName = release.tag_name ?? "";
  const version = tagName.replace(/^release-/, "");

  if (!version) {
    throw new Error(`Unexpected aria2 release tag: ${tagName}`);
  }

  return version;
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    console.log("[prepare-aria2] Skipping auto-setup on this platform.");
    return;
  }

  if (await exists(targetBinary)) {
    console.log(`[prepare-aria2] Found existing binary: ${targetBinary}`);
    return;
  }

  await mkdir(binariesDir, { recursive: true });

  const version = await getLatestAria2Version();
  const zipUrl = `https://sourceforge.net/projects/aria2.mirror/files/release-${version}/aria2-${version}-win-64bit-build1.zip/download`;
  const tempDir = await mkdtemp(join(tmpdir(), "comfy-aria2-"));
  const zipPath = join(tempDir, `aria2-${version}.zip`);
  const extractDir = join(tempDir, "extract");

  console.log(`[prepare-aria2] Downloading aria2 ${version}...`);

  try {
    await mkdir(extractDir, { recursive: true });
    await downloadFile(zipUrl, zipPath);
    await runPowerShellExpandArchive(zipPath, extractDir);

    const extractedBinary = await findFileRecursive(extractDir, "aria2c.exe");
    if (!extractedBinary) {
      throw new Error("aria2c.exe was not found in the downloaded archive");
    }

    await copyFile(extractedBinary, targetBinary);
    console.log(`[prepare-aria2] Saved ${targetBinary}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[prepare-aria2] Failed to prepare aria2c.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
