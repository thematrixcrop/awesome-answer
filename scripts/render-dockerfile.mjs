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
const GITHUB_PATH_PREFIX = "/apache/answer-plugins/tree/main/";
const PLUGIN_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

function asBuffer(rawContent) {
  if (Buffer.isBuffer(rawContent)) {
    return rawContent;
  }

  if (rawContent instanceof Uint8Array || typeof rawContent === "string") {
    return Buffer.from(rawContent);
  }

  throw new TypeError("The plugin descriptor must be a string or a byte buffer.");
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
  const segments = relativePath.split("/");
  const isCanonical =
    parsedLink.protocol === "https:" &&
    parsedLink.hostname === "github.com" &&
    parsedLink.port === "" &&
    parsedLink.username === "" &&
    parsedLink.password === "" &&
    parsedLink.search === "" &&
    parsedLink.hash === "" &&
    link === `https://github.com${GITHUB_PATH_PREFIX}${relativePath}`;
  const hasValidPath =
    relativePath.length > 0 &&
    segments.every(
      (segment) =>
        segment !== "." &&
        segment !== ".." &&
        PLUGIN_SEGMENT_PATTERN.test(segment),
    );

  if (!isCanonical || !hasValidPath) {
    throw new Error(
      `Invalid plugin link at ${location}: expected ` +
        '"https://github.com/apache/answer-plugins/tree/main/<plugin-path>".',
    );
  }

  return `github.com/apache/answer-plugins/${relativePath}`;
}

export function createPluginManifest(
  rawContent,
  { source = DESCRIPTOR_SOURCE, log = logger } = {},
) {
  const descriptorBuffer = asBuffer(rawContent);
  const sha256 = createHash("sha256").update(descriptorBuffer).digest("hex");

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
  const manifest = {
    source,
    sha256,
    pluginCount: sortedPlugins.length,
    plugins: sortedPlugins,
  };

  log.info("descriptor.parsed", {
    localeCount: locales.length,
    entryCount,
    duplicateCount: entryCount - sortedPlugins.length,
    pluginCount: manifest.pluginCount,
    sha256,
  });

  return manifest;
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

export async function renderDockerfile({
  descriptorFile,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  templatePath = DEFAULT_TEMPLATE_PATH,
  fetchImplementation = globalThis.fetch,
  log = logger,
} = {}) {
  if (!descriptorFile && typeof fetchImplementation !== "function") {
    throw new Error("This Node.js version does not provide the Fetch API.");
  }

  const descriptorContent = await readDescriptor({
    descriptorFile,
    fetchImplementation,
    log,
  });
  const manifest = createPluginManifest(descriptorContent, { log });

  const resolvedTemplatePath = path.resolve(templatePath);
  log.info("template.read.started", { location: resolvedTemplatePath });
  const template = await readFile(resolvedTemplatePath, "utf8");
  const renderedDockerfile = ejs.render(
    template,
    { manifest },
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
    pluginCount: manifest.pluginCount,
    sha256: manifest.sha256,
  });

  return {
    dockerfilePath,
    manifestPath,
    manifest,
    renderedDockerfile,
  };
}

function parseArguments(argumentsToParse) {
  const options = {};

  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    if (argument !== "--descriptor-file") {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const descriptorFile = argumentsToParse[index + 1];
    if (!descriptorFile || descriptorFile.startsWith("--")) {
      throw new Error("--descriptor-file requires a file path.");
    }
    if (options.descriptorFile) {
      throw new Error("--descriptor-file can only be specified once.");
    }

    options.descriptorFile = descriptorFile;
    index += 1;
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
