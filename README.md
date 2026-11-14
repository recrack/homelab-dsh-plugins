# Homelab DSH plugins

Reviewed plugin snapshots used by [homelab-deepseek-harness-secure](https://github.com/recrack/homelab-deepseek-harness-secure). The secure image fetches one pinned commit of this repository at build time. The launcher does not clone plugin code or install plugins at runtime.

The secure launcher accepts explicit selections such as `--plugin dsh-browser`. A selected plugin is added to the persistent Web profile and remains installed on later launches. No optional plugin is selected automatically.

## Catalog

| ID | Package | Source | Snapshot | Activation |
| --- | --- | --- | --- | --- |
| `dsh-browser` | `@zseven-w/dsh-browser` | [ZSeven-W/dsh-browser](https://github.com/ZSeven-W/dsh-browser) | `69fa75ac53c36c7f297fcce5ed2595fee62e068c` | Web presets |
| `dsh-crew` | `@zseven-w/dsh-crew` | [ZSeven-W/dsh-crew](https://github.com/ZSeven-W/dsh-crew) | `b00cc6d039cdecf8563b8863aa4b5404285f6e83` | Web bundle |
| `dsh-context` | `dsh-context` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | `0.83.0` plus the local offline patch | Web bundle |
| `dsh-claude-artifacts` | `dsh-claude-artifacts` | [JimLiu/baoyu-design](https://github.com/JimLiu/baoyu-design) | `2.12.1` | Web bundle |
| `dsh-claude-design` | `dsh-claude-design` | [JimLiu/baoyu-design](https://github.com/JimLiu/baoyu-design) | `2.12.1` | Web bundle |

`plugins.json` records package paths, upstream revisions, and activation modes. Each package retains its applicable upstream license and notices. The `dsh-context` snapshot blocks its automatic catalog, balance, and recommendation requests; its upstream source is retained under `packages/dsh-context/upstream/package` for comparison.

## Build

The secure image runs the package build steps from its pinned checkout:

```sh
scripts/build.sh
```

This builds `dsh-browser`, installs the production dependencies for `dsh-crew`, and installs the production dependency for `dsh-context`. The Baoyu package snapshots include their built `lib` files.
