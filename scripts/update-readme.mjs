import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const README_PATH = path.join(REPOSITORY_ROOT, "README.md");
const BLACKLIST_PATH = path.join(REPOSITORY_ROOT, "plugins-blacklist.json");
const ANSWER_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const IMAGE_TAG_PATTERN = /^(v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)_([0-9]{8}))$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function log(level, event, details = {}) {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(record);
}

function requireString(value, name, pattern, description) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Invalid ${name}: expected ${description}.`);
  }
  return value;
}

function validateMetadata(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Metadata must be an object.");
  }
  const answerTag = requireString(metadata.answerTag, "Answer tag", ANSWER_TAG_PATTERN, "vMAJOR.MINOR.PATCH");
  const imageTag = requireString(metadata.imageTag, "image tag", IMAGE_TAG_PATTERN, "vMAJOR.MINOR.PATCH_YYYYMMDD");
  const imageMatch = IMAGE_TAG_PATTERN.exec(imageTag);
  if (imageTag !== `${answerTag}_${imageMatch[5]}`) {
    throw new Error(`Image tag ${imageTag} does not match Answer tag ${answerTag}.`);
  }
  const buildDate = imageMatch[5];
  const date = new Date(`${buildDate.slice(0, 4)}-${buildDate.slice(4, 6)}-${buildDate.slice(6, 8)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10).replaceAll("-", "") !== buildDate) {
    throw new Error(`Invalid image tag date: ${buildDate}.`);
  }
  if (!Number.isInteger(metadata.pluginCount) || metadata.pluginCount < 1) {
    throw new Error("Invalid plugin count: expected a positive integer.");
  }
  const manifestSha256 = requireString(metadata.manifestSha256, "manifest SHA-256", SHA256_PATTERN, "64 lowercase hexadecimal characters");
  const blacklistSha256 = requireString(metadata.blacklistSha256, "blacklist SHA-256", SHA256_PATTERN, "64 lowercase hexadecimal characters");
  const platform = requireString(metadata.platform, "platform", /^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "a Docker platform identifier");
  return { answerTag, imageTag, buildDate, pluginCount: metadata.pluginCount, manifestSha256, blacklistSha256, platform };
}

function normalizeBlacklist(blacklist) {
  if (blacklist === null || typeof blacklist !== "object" || Array.isArray(blacklist)) {
    throw new TypeError("Blacklist must be an object of plugin reasons.");
  }
  return Object.entries(blacklist).sort(([left], [right]) => left.localeCompare(right));
}

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, "<br>");
}

function replaceRegion(readme, name, content) {
  const begin = `<!-- BEGIN AUTO-GENERATED: ${name} -->`;
  const end = `<!-- END AUTO-GENERATED: ${name} -->`;
  const beginCount = readme.split(begin).length - 1;
  const endCount = readme.split(end).length - 1;
  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(`Expected exactly one marker pair for ${name}.`);
  }
  const start = readme.indexOf(begin);
  const finish = readme.indexOf(end);
  if (finish < start) {
    throw new Error(`Markers for ${name} are out of order.`);
  }
  const replacement = `${begin}\n${content.trimEnd()}\n${end}`;
  return `${readme.slice(0, start)}${replacement}${readme.slice(finish + end.length)}`;
}

export function updateReadme(readme, metadata, blacklist) {
  if (typeof readme !== "string") throw new TypeError("README must be a string.");
  const normalized = validateMetadata(metadata);
  const entries = normalizeBlacklist(blacklist);
  const blacklistRows = entries.length === 0
    ? "| _None_ | No plugins are currently blocked. |"
    : entries.map(([plugin, reason]) => {
        const shortName = plugin.startsWith("github.com/apache/answer-plugins/")
          ? plugin.slice("github.com/apache/answer-plugins/".length)
          : plugin;
        return `| \`${markdownCell(shortName)}\` | ${markdownCell(reason)} |`;
      }).join("\n");
  const snapshot = `Snapshot date: **${normalized.buildDate.slice(0, 4)}-${normalized.buildDate.slice(4, 6)}-${normalized.buildDate.slice(6, 8)} UTC**.

| Item | Current value |
| --- | --- |
| Stable upstream release | \`${normalized.answerTag}\` |
| Upstream Docker base image | \`apache/answer:${normalized.answerTag.slice(1)}\` |
| Community image | \`ghcr.io/thematrixcrop/awesome-answer\` |
| Recommended pinned tag | \`${normalized.imageTag}\` |
| Convenience tag | \`latest\` |
| Build platform | \`${normalized.platform}\` |
| Included plugins | ${normalized.pluginCount} |
| Temporarily blocked plugins | ${entries.length} |
| Plugin descriptor SHA-256 | \`${normalized.manifestSha256}\` |
| Blacklist SHA-256 | \`${normalized.blacklistSha256}\` |`;
  const release = `The current stable release is \`${normalized.answerTag}\`. This repository workflow intentionally does not build pre-release versions.

- [Apache Answer ${normalized.answerTag} release](https://github.com/apache/answer/releases/tag/${normalized.answerTag})
- [Apache Answer download page](https://answer.apache.org/download/)
- [Apache Answer Docker tags](https://hub.docker.com/r/apache/answer/tags)

### Image tag semantics

- \`${normalized.imageTag}\` identifies the upstream release and the UTC build date.
- \`latest\` (that is, \`ghcr.io/thematrixcrop/awesome-answer:latest\`) points to the most recently published community image.
- Use the dated tag for reproducible deployments and rollback.
- This README does not hardcode an image digest. The same dated tag can be rebuilt on the same day, so its digest can change.`;
  const dockerImage = `docker run -d \\
  --name awesome-answer \\
  -p 9080:80 \\
  -v awesome-answer-data:/data \\
  ghcr.io/thematrixcrop/awesome-answer:${normalized.imageTag}`;
  const blocked = `| Plugin | Current reason |
| --- | --- |
${blacklistRows}`;
  let updated = replaceRegion(readme, "support-snapshot", snapshot);
  updated = replaceRegion(updated, "release-policy", release);
  updated = replaceRegion(updated, "docker-image-tag", dockerImage);
  updated = replaceRegion(updated, "blocked-plugins", blocked);
  return updated;
}

function parseArguments(args) {
  const names = new Map([
    ["--answer-tag", "answerTag"], ["--image-tag", "imageTag"], ["--plugin-count", "pluginCount"],
    ["--manifest-sha256", "manifestSha256"], ["--blacklist-sha256", "blacklistSha256"], ["--platform", "platform"],
  ]);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    if (!key) throw new Error(`Unknown argument: ${args[index]}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${args[index]} requires a value.`);
    if (Object.hasOwn(options, key)) throw new Error(`${args[index]} can only be specified once.`);
    options[key] = key === "pluginCount" ? Number(value) : value;
    index += 1;
  }
  for (const key of names.values()) if (!Object.hasOwn(options, key)) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required.`);
  return options;
}

async function run() {
  const metadata = parseArguments(process.argv.slice(2));
  const blacklist = JSON.parse(await readFile(BLACKLIST_PATH, "utf8"));
  const readme = await readFile(README_PATH, "utf8");
  const updated = updateReadme(readme, metadata, blacklist);
  if (updated === readme) {
    log("info", "readme.unchanged");
    return;
  }
  await writeFile(README_PATH, updated, "utf8");
  log("info", "readme.updated", { imageTag: metadata.imageTag, blacklistCount: Object.keys(blacklist).length });
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  run().catch((error) => {
    log("error", "readme.update.failed", { errorName: error.name, message: error.message });
    process.exitCode = 1;
  });
}
