import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const version = process.argv[2];

if (!version) {
  throw new Error("Usage: node scripts/sync-version.mjs <version>");
}

function readJson(relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  return { fullPath, value: JSON.parse(fs.readFileSync(fullPath, "utf8")) };
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(rootDir, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

const { value: packageJson } = readJson("package.json");
packageJson.version = version;
writeJson("package.json", packageJson);

const { value: packageLock } = readJson("package-lock.json");
packageLock.version = version;
if (packageLock.packages?.[""]) packageLock.packages[""].version = version;
writeJson("package-lock.json", packageLock);

const { value: tauriConfig } = readJson("src-tauri/tauri.conf.json");
tauriConfig.version = version;
writeJson("src-tauri/tauri.conf.json", tauriConfig);

for (const relativePath of [
  "extensions/chromium/manifest.json",
  "extensions/firefox/manifest.json",
  "extensions/safari/manifest.json",
]) {
  const { value: manifest } = readJson(relativePath);
  manifest.version = version.split("-")[0];
  writeJson(relativePath, manifest);
}

const cargoTomlPath = path.join(rootDir, "src-tauri/Cargo.toml");
const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const updatedCargoToml = cargoToml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
if (updatedCargoToml === cargoToml) {
  throw new Error("Could not find the package version in src-tauri/Cargo.toml");
}
fs.writeFileSync(cargoTomlPath, updatedCargoToml);

const cargoLockPath = path.join(rootDir, "Cargo.lock");
const cargoLock = fs.readFileSync(cargoLockPath, "utf8");
const updatedCargoLock = cargoLock.replace(
  /(\[\[package\]\]\nname = "x-download-manager"\nversion = ")[^"]+(")/,
  `$1${version}$2`
);
if (updatedCargoLock === cargoLock) {
  throw new Error('Could not find the "x-download-manager" package version in Cargo.lock');
}
fs.writeFileSync(cargoLockPath, updatedCargoLock);

console.log(`Synchronized project manifests to ${version}`);
