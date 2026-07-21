# awesome-answer

`thematrixcrop/awesome-answer` is an independent community packaging project for Apache Answer.

> This is an independent community project. It is not Apache Answer, is not an official Apache Software Foundation distribution, and is not affiliated with, endorsed by, or supported by the Apache Answer project.

The project uses an upstream Apache Answer release as its base image, then rebuilds the Answer binary with a curated set of plugins from [`apache/answer-plugins`](https://github.com/apache/answer-plugins). It does not modify or maintain Apache Answer core code.

Use the following issue boundaries:

- Report Apache Answer core behavior to the [Apache Answer project](https://github.com/apache/answer).
- Report image packaging, plugin selection, blacklist, and GHCR publishing issues in this repository.
- Report plugin-specific behavior to the relevant upstream plugin repository.

For upstream licensing and trademark information, see the [Apache Answer repository](https://github.com/apache/answer) and the [Apache Software Foundation trademark policy](https://www.apache.org/foundation/marks/).

## Current Support Snapshot

<!-- BEGIN AUTO-GENERATED: support-snapshot -->
Snapshot date: **2026-07-21 UTC**.

| Item | Current value |
| --- | --- |
| Stable upstream release | `v2.0.2` |
| Upstream Docker base image | `apache/answer:2.0.2` |
| Community image | `ghcr.io/thematrixcrop/awesome-answer` |
| Recommended pinned tag | `v2.0.2_20260721` |
| Convenience tag | `latest` |
| Build platform | `linux/amd64` |
| Included plugins | 29 |
| Temporarily blocked plugins | 2 |
| Plugin descriptor SHA-256 | `1c58a91ce915beb08b929225434eaedd307342843f711670c6262b44a9d5010e` |
| Blacklist SHA-256 | `f3596ca650095fd3c566313b09be0142687028f4b6f4db2c82f9786a0b1466b5` |
<!-- END AUTO-GENERATED: support-snapshot -->

<!-- BEGIN AUTO-GENERATED: release-policy -->
The current stable release is `v2.0.2`. This repository workflow intentionally does not build pre-release versions.

- [Apache Answer v2.0.2 release](https://github.com/apache/answer/releases/tag/v2.0.2)
- [Apache Answer download page](https://answer.apache.org/download/)
- [Apache Answer Docker tags](https://hub.docker.com/r/apache/answer/tags)

### Image tag semantics

- `v2.0.2_20260721` identifies the upstream release and the UTC build date.
- `latest` (that is, `ghcr.io/thematrixcrop/awesome-answer:latest`) points to the most recently published community image.
- Use the dated tag for reproducible deployments and rollback.
- This README does not hardcode an image digest. The same dated tag can be rebuilt on the same day, so its digest can change.
<!-- END AUTO-GENERATED: release-policy -->

## Docker Installation Tutorial

This is the direct Docker deployment flow described by the [official Chinese Apache Answer Docker installation guide](https://answer.apache.org/zh-CN/docs/installation/). The guide uses port `9080`, persists application data under `/data`, and continues setup at `/install`.

### Prerequisites

- Docker Engine or Docker Desktop.
- A host that can run `linux/amd64` containers.
- The current GHCR image can be pulled anonymously. Run `docker login ghcr.io` first if registry rate limits or an organization policy requires authentication.

### Start the container

```bash
<!-- BEGIN AUTO-GENERATED: docker-image-tag -->
docker run -d \
  --name awesome-answer \
  -p 9080:80 \
  -v awesome-answer-data:/data \
  ghcr.io/thematrixcrop/awesome-answer:v2.0.2_20260721
<!-- END AUTO-GENERATED: docker-image-tag -->
```

The host-side port can be changed, for example to `-p 19080:80`. The container port remains `80`.

### Open the installation page

Open:

```text
http://localhost:9080/install
```

Complete the five initialization stages in order:

1. Select the language.
2. Configure the database.
3. Create the configuration file.
4. Enter site information and administrator credentials.
5. Complete initialization.

SQLite is suitable for first-time evaluation. Consider MySQL or PostgreSQL for a production deployment. Set the site URL to the externally reachable URL, including a subdirectory when the site is served below one.

For Compose, upgrade, and local build workflows, use the corresponding [official Apache Answer documentation](https://answer.apache.org/zh-CN/docs/).

### Basic operational checks

```bash
docker ps --filter name=awesome-answer
docker logs -f awesome-answer
```

The `awesome-answer-data` volume persists `/data`. Removing that volume removes the application data, so confirm the target before deleting it.

### Image families

| Image reference | Meaning |
| --- | --- |
| `apache/answer:*` | The official upstream Apache Answer image. |
| `ghcr.io/thematrixcrop/awesome-answer:*` | This community-built image with the curated plugin bundle. |

## Included Plugin Inventory

The inventory below is the active build snapshot after applying the repository blacklist. The full module prefix is:

```text
github.com/apache/answer-plugins/<plugin-name>
```

| Category | Included module paths |
| --- | --- |
| Cache | `cache-redis` |
| CAPTCHA | `captcha-basic`, `captcha-google-v2` |
| CDN | `cdn-aliyun`, `cdn-s3` |
| Connectors | `connector-apache`, `connector-basic`, `connector-dingtalk`, `connector-google` |
| Editors | `editor-chart`, `editor-formula`, `editor-stacks` |
| Embed | `embed-basic` |
| Notifications | `notification-dingtalk`, `notification-slack`, `notification-wecom` |
| Quick links | `quick-links` |
| Rendering | `render-markdown-codehighlight` |
| Moderation | `reviewer-akismet`, `reviewer-baidu`, `reviewer-basic` |
| Search | `search-algolia`, `search-elasticsearch`, `search-meilisearch` |
| Storage | `storage-aliyunoss`, `storage-s3`, `storage-tencentyuncos` |
| User center | `user-center-wecom` |
| Vector search | `vector-search-memory` |

### Temporarily blocked plugins

<!-- BEGIN AUTO-GENERATED: blocked-plugins -->
| Plugin | Current reason |
| --- | --- |
| `connector-wallet` | The frontend build fails because a transitive Coinbase Wallet dependency uses import-attributes syntax that Answer's frontend toolchain cannot parse. Remove this entry after the dependency is compatible with the toolchain. |
| `user-center-slack` | The upstream main branch currently fails with undefined: resty in notification.go:113. Remove this entry after the plugin builds successfully. |
<!-- END AUTO-GENERATED: blocked-plugins -->

The plugin source is the upstream [`apache/answer-plugins` descriptor](https://raw.githubusercontent.com/apache/answer-plugins/main/plugins_desc.json). See the [Apache Answer plugin documentation](https://answer.apache.org/zh-CN/docs/plugins/) and the [Apache Answer plugin repository](https://github.com/apache/answer-plugins) for upstream context.

Plugin availability is a build snapshot, not a guarantee that every upstream plugin will remain buildable forever. The [publishing workflow](https://github.com/thematrixcrop/awesome-answer/blob/main/.github/workflows/publish-docker.yml) rebuilds when the upstream plugin descriptor or this repository blacklist changes.

## Publishing and Version Policy

- Each workflow run reads the latest stable Apache Answer GitHub Release.
- Draft and pre-release versions are rejected.
- `vMAJOR.MINOR.PATCH` is normalized to the upstream Docker tag without the leading `v`.
- New builds generate only the dated release tag and `latest`.
- The workflow does not generate new SemVer aliases, Git SHA aliases, or repository Git tags.
- The workflow currently builds only `linux/amd64`.
- A date-only change does not cause a scheduled rebuild when the plugin manifest, blacklist, and upstream Answer version are unchanged.

Inspect the [GitHub Actions publishing workflow](https://github.com/thematrixcrop/awesome-answer/blob/main/.github/workflows/publish-docker.yml) for the build and publication source.
