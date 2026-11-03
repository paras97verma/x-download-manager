import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const baseVersion = process.env.BASE_VERSION || packageJson.version || "1.0.0";
const channel = process.env.RELEASE_CHANNEL || "stable";
const releaseRef = process.env.RELEASE_REF || "";

if (!new Set(["stable", "beta", "nightly"]).has(channel)) {
  throw new Error(`Unsupported release channel: ${channel}`);
}

function parseSemver(versionStr) {
  const match = versionStr.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function getExistingTags() {
  if (process.env.EXISTING_TAGS) {
    return process.env.EXISTING_TAGS.split("\n").map(t => t.trim()).filter(Boolean);
  }
  try {
    const output = execSync("git tag --list", { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split("\n").map(t => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

let tagName;
if (releaseRef.startsWith("refs/tags/v")) {
  tagName = releaseRef.slice("refs/tags/".length);
} else {
  const existingTags = getExistingTags();
  const base = parseSemver(baseVersion) || [1, 0, 0];

  // Find all existing stable tags
  const stableTags = existingTags
    .map(parseSemver)
    .filter(Boolean)
    .sort(compareSemver);

  if (channel === "stable") {
    if (stableTags.length === 0) {
      // First fresh release starts at v1.0.0 (or baseVersion)
      tagName = `v${base.join(".")}`;
    } else {
      const highestStable = stableTags[stableTags.length - 1];
      if (compareSemver(base, highestStable) > 0) {
        tagName = `v${base.join(".")}`;
      } else {
        // Automatically iterate patch version for the next stable build
        const nextVersion = [highestStable[0], highestStable[1], highestStable[2] + 1];
        tagName = `v${nextVersion.join(".")}`;
      }
    }
  } else {
    // For pre-release channels (beta, nightly), target the next version being developed
    let targetBase;
    if (stableTags.length === 0) {
      targetBase = base;
    } else {
      const highestStable = stableTags[stableTags.length - 1];
      if (compareSemver(base, highestStable) > 0) {
        targetBase = base;
      } else {
        targetBase = [highestStable[0], highestStable[1], highestStable[2] + 1];
      }
    }

    const versionPrefix = `v${targetBase.join(".")}-${channel}.`;
    const channelPattern = new RegExp(`^v${targetBase.join("\\.")}-${channel}\\.(\\d+)$`);
    const channelNumbers = existingTags
      .map(t => t.match(channelPattern))
      .filter(Boolean)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);

    const nextCounter = channelNumbers.length === 0 ? 1 : channelNumbers[channelNumbers.length - 1] + 1;
    tagName = `${versionPrefix}${nextCounter}`;
  }
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tagName)) {
  throw new Error(`Invalid release tag generated: ${tagName}`);
}

const version = tagName.slice(1);
const releaseTitle = `ByteX Download Manager ${tagName}${channel === "stable" || releaseRef.startsWith("refs/tags/v") ? "" : ` (${channel.toUpperCase()})`}`;
process.stdout.write(`version_tag=${tagName}\nversion=${version}\nrelease_title=${releaseTitle}\n`);
