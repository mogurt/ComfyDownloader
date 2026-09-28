import { createWriteStream } from "node:fs";
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");

// Pinned official aria2 release. Checksums were cross-checked against the
// Homebrew (source tarball) and Scoop (Windows zip) package definitions.
const ARIA2_VERSION = "1.37.0";
const ARIA2_RELEASE_URL = `https://github.com/aria2/aria2/releases/download/release-${ARIA2_VERSION}`;
const ARIA2_SOURCE = {
  name: `aria2-${ARIA2_VERSION}.tar.xz`,
  sha256: "60a420ad7085eb616cb6e2bdf0a7206d68ff3d37fb5a956dc44242eb2f79b66b",
};
const ARIA2_WIN64 = {
  name: `aria2-${ARIA2_VERSION}-win-64bit-build1.zip`,
  sha256: "67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288",
};

// Oldest macOS the bundled binary should run on.
const MACOS_DEPLOYMENT_TARGET = "10.15";

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
  // Set when building for another target than the host (e.g. x86_64 macOS
  // bundles built on an Apple Silicon CI runner).
  if (process.env.ARIA2_TARGET_TRIPLE) {
    return process.env.ARIA2_TARGET_TRIPLE;
  }

  try {
    const triple = await execFileText("rustc", ["--print", "host-tuple"]);
    return triple || getFallbackTargetTriple();
  } catch {
    return getFallbackTargetTriple();
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });

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

async function downloadVerified(asset, destination) {
  console.log(`[prepare-aria2] Downloading ${asset.name}...`);
  await downloadFile(`${ARIA2_RELEASE_URL}/${asset.name}`, destination);

  const actual = await sha256File(destination);
  if (actual !== asset.sha256) {
    throw new Error(
      `Checksum mismatch for ${asset.name}: expected ${asset.sha256}, got ${actual}`,
    );
  }
}

function runPowerShellExpandArchive(zipPath, destinationDir) {
  return runCommand("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${destinationDir.replaceAll("'", "''")}' -Force`,
  ]);
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

async function withTempDir(prefix, fn) {
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function prepareWindowsBinary(targetBinary) {
  await withTempDir("comfy-aria2-", async (tempDir) => {
    const zipPath = join(tempDir, ARIA2_WIN64.name);
    const extractDir = join(tempDir, "extract");
    await mkdir(extractDir, { recursive: true });

    await downloadVerified(ARIA2_WIN64, zipPath);
    await runPowerShellExpandArchive(zipPath, extractDir);

    const extractedBinary = await findFileRecursive(extractDir, "aria2c.exe");
    if (!extractedBinary) {
      throw new Error("aria2c.exe was not found in the downloaded archive");
    }

    await copyFile(extractedBinary, targetBinary);
  });
}

// Libraries that exist on every macOS install; anything else (e.g. Homebrew)
// would not be present on users' machines.
function isSystemLibrary(path) {
  return path.startsWith("/usr/lib/") || path.startsWith("/System/Library/");
}

async function assertArchitecture(binary, arch) {
  const archs = await execFileText("lipo", ["-archs", binary]);
  if (archs !== arch) {
    throw new Error(`aria2c was built for "${archs}", expected "${arch}"`);
  }
}

async function assertOnlySystemLibraries(binary) {
  const output = await execFileText("otool", ["-L", binary]);
  const libraries = output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean);
  const foreign = libraries.filter((lib) => !isSystemLibrary(lib));
  if (foreign.length > 0) {
    throw new Error(`aria2c links non-system libraries: ${foreign.join(", ")}`);
  }
}

/**
 * aria2 publishes no macOS binaries, so build the pinned release from source,
 * linking only against system frameworks (AppleTLS) to keep it portable.
 */
async function prepareMacBinary(targetBinary, targetTriple) {
  const arch = targetTriple.startsWith("x86_64") ? "x86_64" : "arm64";

  await withTempDir("comfy-aria2-macos-", async (tempDir) => {
    const tarball = join(tempDir, ARIA2_SOURCE.name);
    await downloadVerified(ARIA2_SOURCE, tarball);
    await runCommand("tar", ["-xJf", tarball, "-C", tempDir]);

    const sourceDir = join(tempDir, `aria2-${ARIA2_VERSION}`);
    // An empty pkg-config search path keeps Homebrew libraries out of the build.
    const emptyPkgConfigDir = join(tempDir, "pkgconfig");
    await mkdir(emptyPkgConfigDir);
    const env = {
      ...process.env,
      MACOSX_DEPLOYMENT_TARGET: MACOS_DEPLOYMENT_TARGET,
      // Build for the target arch. When it differs from the host, configure's
      // test programs run under Rosetta, so no cross-compile setup is needed.
      CC: `clang -arch ${arch}`,
      CXX: `clang++ -arch ${arch}`,
      PKG_CONFIG_PATH: "",
      PKG_CONFIG_LIBDIR: emptyPkgConfigDir,
    };

    console.log(`[prepare-aria2] Building aria2 ${ARIA2_VERSION} from source...`);
    await runCommand(
      "./configure",
      [
        "--disable-dependency-tracking",
        "--disable-nls",
        "--with-appletls",
        "--without-openssl",
        "--without-gnutls",
        "--without-libnettle",
        "--without-libgmp",
        "--without-libgcrypt",
        "--without-libssh2",
        "--without-libcares",
        "--without-sqlite3",
        "--without-libxml2",
        "--without-libexpat",
        "--without-libz",
        "ARIA2_STATIC=no",
      ],
      { cwd: sourceDir, env },
    );
    await runCommand("make", [`-j${cpus().length}`], { cwd: sourceDir, env });

    const builtBinary = join(sourceDir, "src", "aria2c");
    await runCommand("strip", [builtBinary]);
    await assertArchitecture(builtBinary, arch);
    await assertOnlySystemLibraries(builtBinary);

    await copyFile(builtBinary, targetBinary);
    await chmod(targetBinary, 0o755);
  });
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

  // Escape hatch: use a locally provided aria2c instead of fetching/building one.
  const override = process.env.ARIA2C_PATH;
  if (override) {
    await copyFile(override, targetBinary);
    await chmod(targetBinary, 0o755);
    console.log(`[prepare-aria2] Copied ${override} to ${targetBinary}`);
    return;
  }

  if (process.platform === "darwin") {
    await prepareMacBinary(targetBinary, targetTriple);
  } else if (process.platform === "win32" && process.arch === "x64") {
    await prepareWindowsBinary(targetBinary);
  } else {
    console.log(
      `[prepare-aria2] Automatic aria2 setup is not available for ${targetTriple}. ` +
        "Set ARIA2C_PATH to an aria2c binary to bundle it.",
    );
    return;
  }

  console.log(`[prepare-aria2] Saved ${targetBinary}`);
}

main().catch((error) => {
  console.error("[prepare-aria2] Failed to prepare aria2c.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
