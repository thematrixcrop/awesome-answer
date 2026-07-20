import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESCRIPTOR_SOURCE,
  createPluginManifest,
  renderDockerfile,
} from "../scripts/render-dockerfile.mjs";

const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/plugins-desc.json", import.meta.url),
);
const EXPECTED_PLUGINS = [
  "github.com/apache/answer-plugins/cache-redis",
  "github.com/apache/answer-plugins/connector-basic",
  "github.com/apache/answer-plugins/storage-s3",
];
const silentLog = {
  info() {},
  warn() {},
  error() {},
};

async function createTemporaryDirectory(testContext) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "awesome-answer-render-test-"),
  );
  testContext.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("merges locales, removes duplicate links, and sorts plugin paths", async () => {
  const descriptor = await readFile(FIXTURE_PATH);
  const manifest = createPluginManifest(descriptor, { log: silentLog });

  assert.equal(manifest.source, DESCRIPTOR_SOURCE);
  assert.equal(manifest.pluginCount, 3);
  assert.deepEqual(manifest.plugins, EXPECTED_PLUGINS);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
});

test("renders stable Dockerfile and manifest output", async (testContext) => {
  const firstOutput = await createTemporaryDirectory(testContext);
  const secondOutput = await createTemporaryDirectory(testContext);

  const first = await renderDockerfile({
    descriptorFile: FIXTURE_PATH,
    outputDirectory: firstOutput,
    log: silentLog,
  });
  const second = await renderDockerfile({
    descriptorFile: FIXTURE_PATH,
    outputDirectory: secondOutput,
    log: silentLog,
  });

  assert.equal(first.renderedDockerfile, second.renderedDockerfile);
  assert.equal(
    await readFile(first.manifestPath, "utf8"),
    await readFile(second.manifestPath, "utf8"),
  );
  assert.deepEqual(first.manifest, second.manifest);
});

test("changes the SHA-256 when any JSON content changes", async () => {
  const descriptor = await readFile(FIXTURE_PATH, "utf8");
  const changedDescriptor = descriptor.replace(
    "Store uploaded files in S3.",
    "Store uploaded files in an S3-compatible service.",
  );

  const original = createPluginManifest(descriptor, { log: silentLog });
  const changed = createPluginManifest(changedDescriptor, { log: silentLog });

  assert.deepEqual(original.plugins, changed.plugins);
  assert.notEqual(original.sha256, changed.sha256);
});

test("rejects malformed descriptors and unsupported plugin links", () => {
  const cases = [
    {
      name: "top-level array",
      descriptor: [],
      expected: /object of locale arrays/,
    },
    {
      name: "non-array locale",
      descriptor: { en_US: {} },
      expected: /must contain an array/,
    },
    {
      name: "missing link",
      descriptor: { en_US: [{ name: "Missing link" }] },
      expected: /non-empty string "link"/,
    },
    {
      name: "unsupported domain",
      descriptor: {
        en_US: [
          {
            link: "https://example.com/apache/answer-plugins/tree/main/cache-redis",
          },
        ],
      },
      expected: /Invalid plugin link/,
    },
    {
      name: "unsupported branch",
      descriptor: {
        en_US: [
          {
            link: "https://github.com/apache/answer-plugins/tree/develop/cache-redis",
          },
        ],
      },
      expected: /Invalid plugin link/,
    },
    {
      name: "non-object plugin entry",
      descriptor: { en_US: ["cache-redis"] },
      expected: /must be an object/,
    },
  ];

  for (const testCase of cases) {
    assert.throws(
      () =>
        createPluginManifest(JSON.stringify(testCase.descriptor), {
          log: silentLog,
        }),
      testCase.expected,
      testCase.name,
    );
  }
});

test("renders every plugin argument and all manifest labels", async (testContext) => {
  const outputDirectory = await createTemporaryDirectory(testContext);
  const result = await renderDockerfile({
    descriptorFile: FIXTURE_PATH,
    outputDirectory,
    log: silentLog,
  });
  const dockerfile = result.renderedDockerfile;
  const writtenManifest = JSON.parse(
    await readFile(result.manifestPath, "utf8"),
  );

  assert.equal((dockerfile.match(/--with /g) ?? []).length, 3);
  for (const plugin of EXPECTED_PLUGINS) {
    assert.equal(
      dockerfile.split(`--with ${plugin}`).length - 1,
      1,
      `${plugin} must be rendered exactly once`,
    );
  }

  assert.ok(dockerfile.includes("FROM apache/answer:latest AS answer-builder"));
  assert.ok(
    dockerfile.includes(
      `ARG PLUGINS_MANIFEST_SHA256="${result.manifest.sha256}"`,
    ),
  );
  assert.ok(
    dockerfile.includes(
      `io.awesome-answer.plugins.manifest-sha256="${result.manifest.sha256}"`,
    ),
  );
  assert.ok(
    dockerfile.includes(
      `io.awesome-answer.plugins.count="${result.manifest.pluginCount}"`,
    ),
  );
  assert.ok(
    dockerfile.includes(
      `io.awesome-answer.plugins.source="${DESCRIPTOR_SOURCE}"`,
    ),
  );
  assert.deepEqual(writtenManifest, result.manifest);
});
