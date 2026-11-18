# DSH Family Account

This plugin adds the signed-in family member and that member's enabled plugins to the DSH sidebar. Its account panel links to that member's search approval settings. It also places pending public-search approvals below the chat composer, where the member can inspect the exact query or URL and allow or deny it.

The family portal sends account and approval state to the DSH iframe using a versioned `postMessage` channel. Both sides verify the exact same origin and iframe window. The plugin has no account API, credential, model, or telemetry access; logout, administrator navigation, and approval decisions are sent back to the portal.

The secure family profile installs this package as a base bundle. It is not an optional member plugin.
