# DSH Family Account

This plugin adds the signed-in family member and that member's enabled plugins to the DSH sidebar. A persistent action below the chat composer opens pending search approvals and links to the member's automatic-approval setting, even when no request is waiting. Members can inspect the exact query or URL and allow or deny each request.

The family portal sends account and approval state to the DSH iframe using a versioned `postMessage` channel. Both sides verify the exact same origin and iframe window. The plugin has no account API, credential, model, or telemetry access; logout, administrator navigation, and approval decisions are sent back to the portal.

The secure family profile installs this package as a base bundle. It is not an optional member plugin.
