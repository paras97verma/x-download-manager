import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const baseVersion = process.env.BASE_VERSION || packageJson.version;
const channel = process.env.RELEASE_CHANNEL || "stable";
const releaseRef = process.env.RELEASE_REF || "";
const runNumber = process.env.RUN_NUMBER || "0";
const latestTag = process.env.LATEST_TAG || "";

if (!new Set(["stable", "beta", "nightly"]).has(channel)) {
  throw new Error(`Unsupported release channel: ${channel}`);
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`Invalid base version: ${version}`);
  return match.slice(1).map(Number);
}

let tagName;
if (releaseRef.startsWith("refs/tags/v")) {
  tagName = releaseRef.slice("refs/tags/".length);
} else if (channel === "stable") {
  const base = parseVersion(baseVersion);
  const latest = latestTag.startsWith("v") ? latestTag.slice(1) : latestTag;
  let version = base;
  if (latest) {
    const latestParts = parseVersion(latest);
    const baseIsNewer = base.some((part, index) => {
      for (let previous = 0; previous < index; previous += 1) {
        if (base[previous] !== latestParts[previous]) return false;
      }
      return part > latestParts[index];
    });
    if (!baseIsNewer) {
      version = [...latestParts];
      version[2] += 1;
      if (version[2] > 10) {
        version[2] = 0;
        version[1] += 1;
        if (version[1] > 10) {
          version[1] = 0;
          version[0] += 1;
        }
      }
    }
  }
  tagName = `v${version.join(".")}`;
} else {
  tagName = `v${baseVersion}-${channel}.${runNumber}`;
}

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tagName)) {
  throw new Error(`Invalid release tag: ${tagName}`);
}

const version = tagName.slice(1);
const releaseTitle = `ByteX Download Manager ${tagName}${channel === "stable" || releaseRef.startsWith("refs/tags/v") ? "" : ` (${channel.toUpperCase()})`}`;
process.stdout.write(`version_tag=${tagName}\nversion=${version}\nrelease_title=${releaseTitle}\n`);
