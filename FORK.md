# Maintained fork delta

English | [中文](FORK.zh.md)

This repository branch is the DSH Runtime fork used by SuperCode. [`fork-manifest.json`](fork-manifest.json) is the machine-readable inventory; this document explains its ownership and update rules. The fork is based on official `dsh-v0.1.1-rc.2` at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

## Bundle and package inventory

The fork adds **no DSH bundle** and does not change any package under `packages/bundle/`. Product composition remains in SuperCode's `@ainvest-team/supercode-*` packages and closed `supercode-web` patch.

The fork adds two generic DSH packages:

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-session-deletion`](packages/session/session-deletion/README.md) | Host-only recursive deletion of a Session lineage across live state, persistence, projections, query indexes, workspaces, and sidecars. |
| [`@deepseek-ai/dsh-shell-exec-env`](packages/shell/shell-exec-env/README.md) | Optional registry for trusted, non-model environment values resolved immediately before Bash or Pwsh execution. |

The manifest records every modified package, its changed production source files, and the complete `runtimePatchPackages` set that a downstream Runtime must override together. Generated docs, tests, translation records, and repository scripts are not Runtime packages and therefore are not repeated in that list.

## Ownership boundary

This fork contains reusable DSH capabilities and missing extension points only. It does not contain SuperCode UI, AIME authentication, Product policy, Product bundles, or `@ainvest-team/*` code. An external Product plugin may consume the published APIs, but DSH must not import that plugin.

The checked-out SuperCode Submodule is read-only. Develop changes in this standalone fork, run the DSH checks here, publish the fork commit, and then move SuperCode's Submodule commit, `upstream.json` fork binding, Runtime package overrides, and architecture documents together.

## Updating the fork

1. Move the upstream base deliberately and review `git diff <upstream-commit>...HEAD`.
2. Reconcile each fork change against the new official implementation; remove a fork delta when upstream supplies the complete behavior.
3. Update `fork-manifest.json` whenever an added or modified production package changes. `runtimePatchPackages` is the exact union of the added and modified Runtime packages.
4. Keep package READMEs, subsystem references, bilingual Agent Notes, tests, and generated catalogs aligned with the code.
5. In SuperCode, require its `upstream.json.runtimePatchPackages` to match this manifest before accepting the new commit.

The authoritative exhaustive file diff remains Git. The manifest classifies that diff at package and Runtime-assembly level so downstream updates do not rely on commit-message archaeology.
