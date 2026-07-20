import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import ejs from "ejs";

export const DESCRIPTOR_SOURCE =
  "https://raw.githubusercontent.com/apache/answer-plugins/main/plugins_desc.json";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_TEMPLATE_PATH = path.join(REPOSITORY_ROOT, "Dockerfile.ejs");
const DEFAULT_OUTPUT_DIRECTORY = path.join(REPOSITORY_ROOT, ".generated");
export const DEFAULT_BLACKLIST_PATH = path.join(
  REPOSITORY_ROOT,
  "plugins-blacklist.json",
);
const GITHUB_PATH_PREFIX = "/apache/answer-plugins/tree/main/";
const PLUGIN_MODULE_PREFIX = "github.com/apache/answer-plugins/";
const PLUGIN_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ANSWER_RELEASE_TAG_PATTERN =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function normalizeAnswerTag(answerTag) {
  if (typeof answerTag !== "string" || answerTag.length === 0) {
    throw new TypeError(
      'The "answerTag" option is required and must match vMAJOR.MINOR.PATCH.',
    );
  }

  if (!ANSWER_RELEASE_TAG_PATTERN.test(answerTag)) {
    throw new Error(
      `Invalid Answer release tag "${answerTag}": expected a stable vMAJOR.MINOR.PATCH tag.`,
    );
  }

  const answerDockerTag = answerTag.slice(1);
  if (!ANSWER_RELEASE_TAG_PATTERN.test(`v${answerDockerTag}`)) {
    throw new Error(
      `Unable to derive a Docker Hub tag from Answer release tag "${answerTag}".`,
    );
  }
  if (answerDockerTag.length > 128) {
    throw new Error(
      `The Docker Hub tag derived from Answer release tag "${answerTag}" is too long.`,
    );
  }

  return { answerTag, answerDockerTag };
}

function writeLog(level, event, details = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };
  const output = JSON.stringify(record);

  if (level === "error") {
    console.error(output);
    return;
  }

  if (level === "warn") {
    console.warn(output);
    return;
  }

  console.info(output);
}

export const logger = {
  info(event, details) {
    writeLog("info", event, details);
  },
  warn(event, details) {
    writeLog("warn", event, details);
  },
  error(event, details) {
    writeLog("error", event, details);
  },
};

function asBuffer(rawContent, label = "plugin descriptor") {
  if (Buffer.isBuffer(rawContent)) {
    return rawContent;
  }

  if (rawContent instanceof Uint8Array || typeof rawContent === "string") {
    return Buffer.from(rawContent);
  }

  throw new TypeError(`The ${label} must be a string or a byte buffer.`);
}

function hashContent(rawContent, label) {
  return createHash("sha256").update(asBuffer(rawContent, label)).digest("hex");
}

function normalizePluginPath(pluginPath, location) {
  const relativePath =
    typeof pluginPath === "string" &&
    pluginPath.startsWith(PLUGIN_MODULE_PREFIX)
    ? pluginPath.slice(PLUGIN_MODULE_PREFIX.length)
    : "";
  const segments = relativePath.split("/");
  const hasValidPath =
    relativePath.length > 0 &&
    segments.every(
      (segment) =>
        segment !== "." &&
        segment !== ".." &&
        PLUGIN_SEGMENT_PATTERN.test(segment),
    );

  if (!hasValidPath) {
    throw new Error(
      `Invalid plugin path at ${location}: expected "${PLUGIN_MODULE_PREFIX}<plugin-path>".`,
    );
  }

  return `${PLUGIN_MODULE_PREFIX}${relativePath}`;
}

function parsePluginLink(link, location) {
  let parsedLink;
  try {
    parsedLink = new URL(link);
  } catch (error) {
    throw new Error(`Invalid plugin link at ${location}: ${error.message}`, {
      cause: error,
    });
  }

  const relativePath = parsedLink.pathname.startsWith(GITHUB_PATH_PREFIX)
    ? parsedLink.pathname.slice(GITHUB_PATH_PREFIX.length)
    : "";
  const isCanonical =
    parsedLink.protocol === "https:" &&
    parsedLink.hostname === "github.com" &&
    parsedLink.port === "" &&
    parsedLink.username === "" &&
    parsedLink.password === "" &&
    parsedLink.search === "" &&
    parsedLink.hash === "" &&
    link === `https://github.com${GITHUB_PATH_PREFIX}${relativePath}`;
  if (!isCanonical) {
    throw new Error(
      `Invalid plugin link at ${location}: expected ` +
        '"https://github.com/apache/answer-plugins/tree/main/<plugin-path>".',
    );
  }

  return normalizePluginPath(
    `${PLUGIN_MODULE_PREFIX}${relativePath}`,
    location,
  );
}

export function createPluginManifest(
  rawContent,
  {
    source = DESCRIPTOR_SOURCE,
    blacklist = [],
    blacklistSha256 = hashContent("{}", "plugin blacklist"),
    log = logger,
  } = {},
) {
  const descriptorBuffer = asBuffer(rawContent);
  const sha256 = hashContent(descriptorBuffer, "plugin descriptor");

  let descriptor;
  try {
    descriptor = JSON.parse(descriptorBuffer.toString("utf8"));
  } catch (error) {
    throw new Error(`The plugin descriptor is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }

  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor)
  ) {
    throw new Error("The plugin descriptor must be an object of locale arrays.");
  }

  const locales = Object.entries(descriptor);
  if (locales.length === 0) {
    throw new Error("The plugin descriptor must contain at least one locale.");
  }

  const plugins = new Set();
  let entryCount = 0;

  for (const [locale, entries] of locales) {
    if (locale.trim().length === 0) {
      throw new Error("The plugin descriptor contains an empty locale name.");
    }

    if (!Array.isArray(entries)) {
      throw new Error(`Locale "${locale}" must contain an array of plugins.`);
    }

    if (entries.length === 0) {
      log.warn("descriptor.locale.empty", { locale });
    }

    for (const [index, entry] of entries.entries()) {
      const location = `"${locale}"[${index}]`;
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Plugin entry at ${location} must be an object.`);
      }

      if (typeof entry.link !== "string" || entry.link.length === 0) {
        throw new Error(
          `Plugin entry at ${location} must contain a non-empty string "link".`,
        );
      }

      plugins.add(parsePluginLink(entry.link, location));
      entryCount += 1;
    }
  }

  if (plugins.size === 0) {
    throw new Error("The plugin descriptor must contain at least one plugin.");
  }

  const sortedPlugins = [...plugins].sort();
  if (!Array.isArray(blacklist)) {
    throw new TypeError("The plugin blacklist must be an array of plugin paths.");
  }
  const blacklistSet = new Set(blacklist);
  for (const blacklistedPlugin of blacklistSet) {
    normalizePluginPath(blacklistedPlugin, "plugin blacklist");
    if (!plugins.has(blacklistedPlugin)) {
      log.warn("blacklist.plugin.not_found", { plugin: blacklistedPlugin });
    }
  }

  const selectedPlugins = sortedPlugins.filter(
    (plugin) => !blacklistSet.has(plugin),
  );
  const excludedPlugins = sortedPlugins.filter((plugin) =>
    blacklistSet.has(plugin),
  );
  if (selectedPlugins.length === 0) {
    throw new Error("The plugin blacklist excludes every plugin in the descriptor.");
  }

  const manifest = {
    source,
    sha256,
    pluginCount: selectedPlugins.length,
    plugins: selectedPlugins,
  };

  log.info("descriptor.parsed", {
    localeCount: locales.length,
    entryCount,
    duplicateCount: entryCount - sortedPlugins.length,
    blacklistedCount: excludedPlugins.length,
    upstreamPluginCount: sortedPlugins.length,
    pluginCount: manifest.pluginCount,
    sha256,
    blacklistSha256,
  });

  return manifest;
}

export function createPluginBlacklist(
  rawContent,
  { log = logger } = {},
) {
  const blacklistBuffer = asBuffer(rawContent, "plugin blacklist");
  const sha256 = hashContent(blacklistBuffer, "plugin blacklist");

  let blacklist;
  try {
    blacklist = JSON.parse(blacklistBuffer.toString("utf8"));
  } catch (error) {
    throw new Error(`The plugin blacklist is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }

  if (
    blacklist === null ||
    typeof blacklist !== "object" ||
    Array.isArray(blacklist)
  ) {
    throw new Error("The plugin blacklist must be an object of plugin reasons.");
  }

  for (const [pluginPath, reason] of Object.entries(blacklist)) {
    normalizePluginPath(pluginPath, `plugin blacklist key "${pluginPath}"`);
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error(
        `Plugin blacklist entry "${pluginPath}" must contain a non-empty reason.`,
      );
    }
  }

  const plugins = Object.keys(blacklist).sort();
  log.info("blacklist.parsed", {
    pluginCount: plugins.length,
    sha256,
  });

  return { plugins, sha256 };
}

async function readDescriptor({ descriptorFile, fetchImplementation, log }) {
  if (descriptorFile) {
    const descriptorPath = path.resolve(descriptorFile);
    log.info("descriptor.read.started", {
      inputType: "file",
      location: descriptorPath,
    });
    const content = await readFile(descriptorPath);
    log.info("descriptor.read.completed", {
      inputType: "file",
      location: descriptorPath,
      bytes: content.byteLength,
    });
    return content;
  }

  log.info("descriptor.read.started", {
    inputType: "url",
    location: DESCRIPTOR_SOURCE,
  });
  const response = await fetchImplementation(DESCRIPTOR_SOURCE, {
    headers: {
      accept: "application/json",
      "user-agent": "awesome-answer-dockerfile-renderer",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Unable to read the plugin descriptor: HTTP ${response.status} ${response.statusText}.`,
    );
  }

  const content = Buffer.from(await response.arrayBuffer());
  log.info("descriptor.read.completed", {
    inputType: "url",
    location: DESCRIPTOR_SOURCE,
    bytes: content.byteLength,
  });
  return content;
}

async function readBlacklist({ blacklistFile, log }) {
  if (blacklistFile === null) {
    const content = Buffer.from("{}");
    log.info("blacklist.read.completed", {
      inputType: "disabled",
      bytes: content.byteLength,
    });
    return content;
  }

  const resolvedBlacklistPath = path.resolve(blacklistFile);
  log.info("blacklist.read.started", {
    inputType: "file",
    location: resolvedBlacklistPath,
  });
  const content = await readFile(resolvedBlacklistPath);
  log.info("blacklist.read.completed", {
    inputType: "file",
    location: resolvedBlacklistPath,
    bytes: content.byteLength,
  });
  return content;
}

export async function renderDockerfile({
  answerTag,
  descriptorFile,
  blacklistFile = DEFAULT_BLACKLIST_PATH,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  templatePath = DEFAULT_TEMPLATE_PATH,
  fetchImplementation = globalThis.fetch,
  log = logger,
} = {}) {
  const normalizedAnswer = normalizeAnswerTag(answerTag);
  log.info("answer.release.validated", normalizedAnswer);

  if (!descriptorFile && typeof fetchImplementation !== "function") {
    throw new Error("This Node.js version does not provide the Fetch API.");
  }

  const descriptorContent = await readDescriptor({
    descriptorFile,
    fetchImplementation,
    log,
  });
  const blacklistContent = await readBlacklist({ blacklistFile, log });
  const blacklist = createPluginBlacklist(blacklistContent, { log });
  const manifest = createPluginManifest(descriptorContent, {
    blacklist: blacklist.plugins,
    blacklistSha256: blacklist.sha256,
    log,
  });
  const renderManifest = {
    ...manifest,
    blacklistSha256: blacklist.sha256,
  };

  const resolvedTemplatePath = path.resolve(templatePath);
  log.info("template.read.started", { location: resolvedTemplatePath });
  const template = await readFile(resolvedTemplatePath, "utf8");
  const renderedDockerfile = ejs.render(
    template,
    {
      manifest: renderManifest,
      answerTag: normalizedAnswer.answerTag,
      answerDockerTag: normalizedAnswer.answerDockerTag,
    },
    { filename: resolvedTemplatePath },
  );

  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const dockerfilePath = path.join(resolvedOutputDirectory, "Dockerfile");
  const manifestPath = path.join(
    resolvedOutputDirectory,
    "plugins-manifest.json",
  );
  await mkdir(resolvedOutputDirectory, { recursive: true });
  await Promise.all([
    writeFile(dockerfilePath, renderedDockerfile, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ]);

  log.info("render.completed", {
    dockerfilePath,
    manifestPath,
    answerTag: normalizedAnswer.answerTag,
    answerDockerTag: normalizedAnswer.answerDockerTag,
    pluginCount: manifest.pluginCount,
    sha256: manifest.sha256,
    blacklistSha256: blacklist.sha256,
    blacklistPluginCount: blacklist.plugins.length,
  });

  return {
    dockerfilePath,
    manifestPath,
    manifest,
    answerTag: normalizedAnswer.answerTag,
    answerDockerTag: normalizedAnswer.answerDockerTag,
    blacklistSha256: blacklist.sha256,
    blacklistPlugins: blacklist.plugins,
    renderedDockerfile,
  };
}

function parseArguments(argumentsToParse) {
  const options = {};
  const optionNames = {
    "--answer-tag": "answerTag",
    "--descriptor-file": "descriptorFile",
    "--blacklist-file": "blacklistFile",
  };

  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    const optionName = optionNames[argument];
    if (!Object.hasOwn(optionNames, argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argumentsToParse[index + 1];
    if (!value || value.startsWith("--")) {
      const valueDescription =
        argument === "--answer-tag" ? "an Answer release tag" : "a file path";
      throw new Error(`${argument} requires ${valueDescription}.`);
    }
    if (Object.hasOwn(options, optionName)) {
      throw new Error(`${argument} can only be specified once.`);
    }

    options[optionName] = value;
    index += 1;
  }

  if (!Object.hasOwn(options, "answerTag")) {
    throw new Error("--answer-tag is required.");
  }

  return options;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  await renderDockerfile(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  run().catch((error) => {
    logger.error("render.failed", {
      errorName: error.name,
      message: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
  });
}
