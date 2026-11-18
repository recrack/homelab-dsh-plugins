# DSH Family Account

This plugin adds the signed-in family member and that member's enabled plugins to the DSH sidebar. A persistent action below the chat composer opens pending search approvals and links to the member's automatic-approval setting, even when no request is waiting. Members can inspect the exact query or URL and allow or deny each request.

DSH opens directly at the family portal's `/workspace/` URL. The plugin uses the portal's same-origin `/api/family/workspace` endpoint to read the signed-in account and its approval queue and to submit approval decisions. It signs out through Better Auth and opens full search settings at `/family/search-approval`.

The secure family profile installs this package as a base bundle. It is not an optional member plugin.
