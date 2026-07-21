import test from "node:test";
import assert from "node:assert/strict";

import { updateReadme } from "../scripts/update-readme.mjs";

const metadata = {
  answerTag: "v2.0.2",
  imageTag: "v2.0.2_20260721",
  pluginCount: 29,
  manifestSha256: "a".repeat(64),
  blacklistSha256: "b".repeat(64),
  platform: "linux/amd64",
};
const readme = [
  "# Test",
  "<!-- BEGIN AUTO-GENERATED: support-snapshot -->",
  "old",
  "<!-- END AUTO-GENERATED: support-snapshot -->",
  "<!-- BEGIN AUTO-GENERATED: release-policy -->",
  "old",
  "<!-- END AUTO-GENERATED: release-policy -->",
  "<!-- BEGIN AUTO-GENERATED: docker-image-tag -->",
  "old",
  "<!-- END AUTO-GENERATED: docker-image-tag -->",
  "<!-- BEGIN AUTO-GENERATED: blocked-plugins -->",
  "old",
  "<!-- END AUTO-GENERATED: blocked-plugins -->",
].join("\n");

test("updates all generated regions and is idempotent", () => {
  const blacklist = {
    "github.com/apache/answer-plugins/example": "reason | with\nline",
  };
  const updated = updateReadme(readme, metadata, blacklist);
  assert.match(updated, /Snapshot date: \*\*2026-07-21 UTC\*\*/);
  assert.match(updated, /Included plugins \| 29/);
  assert.match(updated, /`example` \| reason \\| with<br>line/);
  assert.match(updated, /ghcr\.io\/thematrixcrop\/awesome-answer:v2\.0\.2_20260721/);
  assert.equal(updateReadme(updated, metadata, blacklist), updated);
});

test("rejects invalid metadata and markers", () => {
  assert.throws(() => updateReadme(readme, { ...metadata, imageTag: "v2.0.2_20260230" }, {}), /Invalid image tag date/);
  assert.throws(() => updateReadme(readme.replace("<!-- END AUTO-GENERATED: blocked-plugins -->", ""), metadata, {}), /marker pair/);
  assert.throws(() => updateReadme(readme, { ...metadata, manifestSha256: "bad" }, {}), /manifest SHA-256/);
});
