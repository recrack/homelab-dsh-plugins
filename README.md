# Homelab DSH plugins

This repository stores reviewed plugin package snapshots for [homelab-deepseek-harness-secure](https://github.com/recrack/homelab-deepseek-harness-secure). It owns the upstream revision records, local hardening, package build steps, and applicable notices. The secure repository owns image construction, the supported plugin ID list, persistent profile activation, and the runtime network policy.

The secure image fetches one pinned commit of this repository and builds its packages during the Docker image build. The existing `dsh-browser` plugin defaults to Chromium; Camoufox is an optional engine in that same plugin and uses a separate secure deployment image with its pinned browser and fingerprint model preloaded at build time. At launch, `--plugin <id>` selects packages already in the image and adds them to the persistent Web profile. The launcher does not clone plugin sources at runtime. New state directories select no optional plugins by default; existing selections persist. See the secure deployment's [plugin build and activation architecture](https://github.com/recrack/homelab-deepseek-harness-secure/blob/master/deploy/offline/README.md#build-and-activation).

## Catalog

| ID | Package | Source | Snapshot | Activation |
| --- | --- | --- | --- | --- |
| `dsh-browser` | `@zseven-w/dsh-browser` | [ZSeven-W/dsh-browser](https://github.com/ZSeven-W/dsh-browser) | `838637338c56b777abad9e43468b59db75f777ff` | Web presets; optional Camoufox engine |
| `dsh-context` | `dsh-context` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | `0.83.0` plus the local offline patch | Web bundle |
| `dsh-claude-artifacts` | `dsh-claude-artifacts` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Shared Web bundle |
| `dsh-claude-slides` | `dsh-claude-slides` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Web bundle |
| `dsh-claude-design` | `dsh-claude-design` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Web bundle |
| `dsh-claude-design-system` | `dsh-claude-design-system` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Web bundle |
| `dsh-claude-data` | `dsh-claude-data` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Web bundle |
| `dsh-claude-motion` | `dsh-claude-motion` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Web bundle |
| `dsh-claude-whiteboard` | `dsh-claude-whiteboard` | [JimLiu/open-artifacts](https://github.com/JimLiu/open-artifacts) | `2.16.0`, SHA-512 pinned | Web bundle |
| `dsh-crew` | `@zseven-w/dsh-crew` | [ZSeven-W/dsh-crew](https://github.com/ZSeven-W/dsh-crew) | `b00cc6d039cdecf8563b8863aa4b5404285f6e83` | Web bundle |

`plugins.json` records package paths, upstream revisions, activation types, and SHA-512 hashes for the Open Artifacts npm tarballs stored under `packages/open-artifacts/snapshots/`. `scripts/build.sh` verifies and extracts those tarballs into an ignored generated directory; the image build needs no npm registry access for Open Artifacts. Each package retains its applicable upstream license and notices. The `dsh-context` snapshot blocks its automatic catalog, balance, and recommendation requests; its upstream source is retained under `packages/dsh-context/upstream/package` for comparison.

## How the secure deployment uses these packages

| Stage | Owner | Behavior |
| --- | --- | --- |
| Snapshot | This repository | Stores reviewed package code, upstream pins, and local hardening. |
| Image build | `homelab-deepseek-harness-secure` | Fetches a pinned commit and builds or stages the packages inside the Docker image. |
| Runtime selection | `homelab-deepseek-harness-secure` | The Python launcher accepts explicit IDs and records selected local packages in the persistent Web profile. The Plugin Manager UI and tool are disabled. |
| Activation | DSH Cordis profile | Bundle entries join the profile's bundle list; `dsh-browser` is added to shipped Web presets. Selected code runs in the DSH container and follows its network policy. |

The [Archify snapshot-to-runtime diagram](.archify/architecture-plugin-snapshot-handoff-20261115-010540/architecture.html) expands these stages, including the pinned image handoff and the container network policy. Open the standalone HTML file in a browser from a local checkout.

Adding an entry to `plugins.json` alone does not make a plugin selectable. A new package also needs image-build and runtime profile wiring in the secure repository. Every supported ID must be added to its validation and profile configuration; preset-based plugins also need a preset row. The linked [architecture guide](https://github.com/recrack/homelab-deepseek-harness-secure/blob/master/deploy/offline/README.md#build-and-activation) names those owners.

## Build

The secure image runs this script from its pinned checkout:

```sh
scripts/build.sh
```

This verifies and extracts the Open Artifacts snapshots, builds `dsh-browser` with its pinned Camoufox runtime dependencies, installs the production dependencies for `dsh-crew`, and installs the production dependency for `dsh-context`. Browser and fingerprint-model binaries are added only by the secure deployment optional image build. The Open Artifacts packages include their prebuilt editors and skill files.
