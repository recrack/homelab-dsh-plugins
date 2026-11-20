---
name: homelab-dsh-plugin-integration
description: Add, update, or remove a third-party DSH plugin across the Homelab plugin catalog, Secure DSH offline runtime, and family portal. Use for an upstream DSH plugin URL, a plugin rollout, or validation that family accounts can use a plugin.
---

# Homelab DSH plugin integration

Keep the upstream DSH extension points and make the integration changes in the three Homelab repositories. Check the current default branches and live image when planning an update.

## Integrate the plugin

1. **`recrack/homelab-dsh-plugins`**. Inspect the upstream package manifest, bundle patch or preset, host and client dependencies, license, and runtime network calls. Pin the source revision in `plugins.json`. Use the existing catalog and build scripts. Keep runtime installs reproducible from the selected revision and any dependency lockfile. Preserve license notices. Remove or disable disallowed egress at the entry points that can trigger it, including host tools, direct commands, and browser-side requests. Keep local functionality testable.
2. **`recrack/homelab-deepseek-harness-secure`**. Update `deploy/offline/run.py`, `prepare-presets.mjs`, and `profile_plugins.py` as applicable. Check the distinction between a Web bundle and a preset contribution. Expose the package and host dependencies in each applicable offline Docker build path. Pin the merged Homelab plugin catalog revision. Check profile installation with and without the plugin selected.
3. **`recrack/homelab-dsh-family`**. Update `portal/src/lib/family-plugins.ts` and both validation paths in `portal/scripts/run-member-dsh.sh`. Verify saved member settings, profile composition, and required dependencies. Keep the new plugin opt-in unless the requested rollout calls for a different default.

## Validate, publish, and deploy

1. Build the candidate image and verify that the plugin loads through normal DSH entry points. Exercise the core action with any network restrictions the release will use.
2. Run the relevant catalog, profile and member-launch tests. For changes that affect a family rollout, sign in through the family portal with the selected test accounts. Create a fresh DSH session, invoke the plugin through its real UI or chat, and confirm the actual side effect and account isolation. Use `test1`, `test2`, and `test3` for a three-account rollout. Check an unselected account when testing optional activation. Verify feature behavior separately from the presence of a menu label.
3. Publish scoped commits and PRs to the `recrack` repositories when authorized. Verify the authenticated GitHub account and target. Merge the catalog change before choosing the image pin. Check CI and align the portal and runtime rollout with the image containing that pin.
4. For an authorized deployment, verify the effective systemd image and per-member selection. Restart the affected services, wait for the portal and runtime to answer, and repeat the feature smoke on the deployed image. Keep the prior image and settings available for rollback. Preserve other member settings, workspaces and approval preferences.

Report the PR links and merge state, deployed image or revision, tested account actions, and anything still pending. Keep credentials, cookies, runtime tokens, and private session data out of commits and test reports.
