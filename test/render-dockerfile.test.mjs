import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BLACKLIST_PATH,
  DESCRIPTOR_SOURCE,
  createPluginBlacklist,
  createPluginManifest,
  normalizeAnswerTag,
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
    answerTag: "v2.0.1",
    descriptorFile: FIXTURE_PATH,
    outputDirectory: firstOutput,
    log: silentLog,
  });
  const second = await renderDockerfile({
    answerTag: "v2.0.1",
    descriptorFile: FIXTURE_PATH,
    outputDirectory: secondOutput,
    log: silentLog,
  });

  assert.equal(first.renderedDockerfile, second.renderedDockerfile);
  assert.equal(first.answerTag, "v2.0.1");
  assert.equal(first.answerDockerTag, "2.0.1");
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

test("filters a blacklisted plugin and preserves both input digests", () => {
  const descriptor = JSON.stringify({
    en_US: [
      {
        link: "https://github.com/apache/answer-plugins/tree/main/cache-redis",
      },
      {
        link: "https://github.com/apache/answer-plugins/tree/main/user-center-slack",
      },
    ],
  });
  const blacklistContent = JSON.stringify({
    "github.com/apache/answer-plugins/user-center-slack": "Broken upstream build",
  });
  const blacklist = createPluginBlacklist(blacklistContent, { log: silentLog });
  const manifest = createPluginManifest(descriptor, {
    blacklist: blacklist.plugins,
    blacklistSha256: blacklist.sha256,
    log: silentLog,
  });

  assert.equal(manifest.pluginCount, 1);
  assert.deepEqual(manifest.plugins, [
    "github.com/apache/answer-plugins/cache-redis",
  ]);
  assert.match(blacklist.sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
});

test("rejects malformed blacklist entries", () => {
  assert.throws(
    () => createPluginBlacklist("[]", { log: silentLog }),
    /object of plugin reasons/,
  );
  assert.throws(
    () =>
      createPluginBlacklist(
        JSON.stringify({
          "https://github.com/apache/answer-plugins/tree/main/cache-redis":
            "Use the module path",
        }),
        { log: silentLog },
      ),
    /Invalid plugin path/,
  );
  assert.throws(
    () =>
      createPluginBlacklist(
        JSON.stringify({
          "github.com/apache/answer-plugins/cache-redis": "",
        }),
        { log: silentLog },
      ),
    /non-empty reason/,
  );
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
    answerTag: "v2.0.1",
    descriptorFile: FIXTURE_PATH,
    outputDirectory,
    log: silentLog,
  });
  const dockerfile = result.renderedDockerfile;
  const writtenManifest = JSON.parse(
    await readFile(result.manifestPath, "utf8"),
  );
  const blacklistContent = await readFile(DEFAULT_BLACKLIST_PATH);
  const expectedBlacklistSha256 = createPluginBlacklist(blacklistContent, {
    log: silentLog,
  }).sha256;

  assert.equal((dockerfile.match(/--with /g) ?? []).length, 3);
  for (const plugin of EXPECTED_PLUGINS) {
    assert.equal(
      dockerfile.split(`--with ${plugin}`).length - 1,
      1,
      `${plugin} must be rendered exactly once`,
    );
  }

  assert.ok(dockerfile.includes("FROM apache/answer:2.0.1 AS answer-builder"));
  assert.ok(
    dockerfile.includes(
      `ARG PLUGINS_MANIFEST_SHA256="${result.manifest.sha256}"`,
    ),
  );
  assert.ok(
    dockerfile.includes(
      `ARG PLUGINS_BLACKLIST_SHA256="${expectedBlacklistSha256}"`,
    ),
  );
  assert.ok(
    dockerfile.includes(
      `io.awesome-answer.plugins.manifest-sha256="${result.manifest.sha256}"`,
    ),
  );
  assert.ok(
    dockerfile.includes(
      `io.awesome-answer.plugins.blacklist-sha256="${expectedBlacklistSha256}"`,
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

test("uses the repository blacklist when rendering a descriptor", async (testContext) => {
  const outputDirectory = await createTemporaryDirectory(testContext);
  const descriptorPath = path.join(outputDirectory, "descriptor.json");
  await writeFile(
    descriptorPath,
    JSON.stringify({
      en_US: [
        {
          link: "https://github.com/apache/answer-plugins/tree/main/cache-redis",
        },
        {
          link: "https://github.com/apache/answer-plugins/tree/main/user-center-slack",
        },
      ],
    }),
  );

  const result = await renderDockerfile({
    answerTag: "v2.0.1",
    descriptorFile: descriptorPath,
    outputDirectory,
    log: silentLog,
  });

  assert.deepEqual(result.manifest.plugins, [
    "github.com/apache/answer-plugins/cache-redis",
  ]);
  assert.equal(result.manifest.pluginCount, 1);
  assert.ok(!result.renderedDockerfile.includes("user-center-slack"));
});

test("requires a stable Answer release tag", async (testContext) => {
  const outputDirectory = await createTemporaryDirectory(testContext);

  await assert.rejects(
    () =>
      renderDockerfile({
        descriptorFile: FIXTURE_PATH,
        outputDirectory,
        log: silentLog,
      }),
    /answerTag.*required/i,
  );

  for (const answerTag of [
    "2.0.1",
    "v2.0",
    "v2.0.1-rc.1",
    "v2.0.1+build.1",
    "v02.0.1",
  ]) {
    assert.throws(
      () => normalizeAnswerTag(answerTag),
      /stable vMAJOR\.MINOR\.PATCH/i,
      answerTag,
    );
  }
});

test("normalizes only the v prefix for a stable Answer release", async () => {
  assert.deepEqual(normalizeAnswerTag("v2.0.1"), {
    answerTag: "v2.0.1",
    answerDockerTag: "2.0.1",
  });
});
