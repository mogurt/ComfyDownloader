import { createWriteStream } from "node:fs";
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function execFileText(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise(stdout.trim());
    });
  });
}

function getFallbackTargetTriple() {
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "aarch64-apple-darwin";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "x86_64-apple-darwin";
  }

  return null;
}

async function getTargetTriple() {
  try {
    const triple = await execFileText("rustc", ["--print", "host-tuple"]);
    return triple || getFallbackTargetTriple();
  } catch {
    return getFallbackTargetTriple();
  }
}

async function findOnPath(command) {
  const locator = process.platform === "win32" ? "where" : "which";

  try {
    const output = await execFileText(locator, [command]);
    const [firstMatch] = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return firstMatch ?? null;
  } catch {
    return null;
  }
}

function runCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} failed with exit code ${code}`));
    });

    child.on("error", rejectPromise);
  });
}

function buildGithubHeaders() {
  const headers = {
    "User-Agent": "comfy-downloader-setup",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: buildGithubHeaders() });

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

async function sha256File(path) {
  const buffer = await readFile(path);
  return createHash("sha256").update(buffer).digest("hex");
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

async function getLatestAria2BuilderRelease() {
  return fetchJson("https://api.github.com/repos/AnInsomniacy/aria2-builder/releases/latest");
}

function getMacAssetSuffix() {
  if (process.arch === "arm64") {
    return "macos-arm64.tar.bz2";
  }

  if (process.arch === "x64") {
    return "macos-x86_64.tar.bz2";
  }

  return null;
}

async function prepareMacBinary(targetBinary) {
  const assetSuffix = getMacAssetSuffix();
  if (!assetSuffix) {
    throw new Error(`Unsupported macOS architecture: ${process.arch}`);
  }

  const release = await getLatestAria2BuilderRelease();
  const asset = release.assets?.find((entry) => entry.name?.endsWith(assetSuffix));
  if (!asset?.browser_download_url) {
    throw new Error(`No macOS aria2 asset found for ${assetSuffix}`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "comfy-aria2-macos-"));
  const archivePath = join(tempDir, asset.name);
  const extractDir = join(tempDir, "extract");

  console.log(`[prepare-aria2] Downloading ${asset.name}...`);

  try {
    await mkdir(extractDir, { recursive: true });
    await downloadFile(asset.browser_download_url, archivePath);

    if (typeof asset.digest === "string" && asset.digest.startsWith("sha256:")) {
      const expected = asset.digest.slice("sha256:".length);
      const actual = await sha256File(archivePath);
      if (actual !== expected) {
        throw new Error(`Checksum mismatch for ${asset.name}`);
      }
    }

    await runCommand("tar", ["-xjf", archivePath, "-C", extractDir]);

    const extractedBinary = await findFileRecursive(extractDir, "aria2c");
    if (!extractedBinary) {
      throw new Error("aria2c was not found in the downloaded archive");
    }

    await copyFile(extractedBinary, targetBinary);
    await chmod(targetBinary, 0o755);
    console.log(`[prepare-aria2] Saved ${targetBinary}`);
  } catch (error) {
    const installedAria2 = await findOnPath("aria2c");
    if (installedAria2) {
      await copyFile(installedAria2, targetBinary);
      await chmod(targetBinary, 0o755);
      console.warn(
        `[prepare-aria2] Download failed, fell back to local aria2c: ${installedAria2}`,
      );
      return;
    }

    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const targetTriple = await getTargetTriple();
  if (!targetTriple) {
    console.log(
      `[prepare-aria2] No aria2 setup is configured for ${process.platform}/${process.arch}.`,
    );
    return;
  }

  const extension = targetTriple.includes("windows") ? ".exe" : "";
  const targetBinary = join(binariesDir, `aria2c-${targetTriple}${extension}`);

  if (await exists(targetBinary)) {
    console.log(`[prepare-aria2] Found existing binary: ${targetBinary}`);
    return;
  }

  await mkdir(binariesDir, { recursive: true });

  if (process.platform === "darwin") {
    await prepareMacBinary(targetBinary);
    return;
  }

  if (process.platform !== "win32" || process.arch !== "x64") {
    console.log(
      `[prepare-aria2] Automatic aria2 setup is not available for ${targetTriple}.`,
    );
    return;
  }

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
