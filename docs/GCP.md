# GCP connector

> Read-only Cloud Storage on your own Google Cloud project, as agent tools.

The GCP connector links Curtis to a Google Cloud project with a service-account key and exposes three read-only Cloud Storage tools to agent mode: list buckets, list objects, read one object. Ask about your buckets in chat and Curtis answers from the live API — no copy-pasting console output.

## Why a service-account key, and why read-only

Google Cloud doesn't hand personal logins to programs. A **service account** is an identity created for software, and a **key file** is its credential — a JSON file holding a private key that lets an application sign in as that identity. The identity carries permissions you grant, and nothing more: the key file can only do what the service account is allowed to do.

That mechanism is what makes the connector's safety default possible. Curtis asks for the narrowest grant that works — read-only Cloud Storage. The principle is least privilege: give a credential only what it needs, so its worst case stays small. If this key ever leaks, what's exposed is data you could already read; nothing on your buckets can be deleted, overwritten, or uploaded. That's why the setup below stops at a viewer role and why writes are out of scope in v1.

## Setup

1. In the Google Cloud console, create a service account (IAM & Admin → Service accounts) and grant it read access. **Storage Object Viewer** (`roles/storage.objectViewer`) covers object listing and reads; bucket *listing* additionally needs `storage.buckets.list`, which **Storage Viewer** (`roles/storage.viewer`) or a custom role grants.
2. Create a JSON key for the account (Keys → Add key → JSON) and download it.
3. In Obsidian: **Settings → Curtis.ai → GCP → Enable GCP connector**, then **Add key** and paste the key file's full contents. The key is stored in the OS keychain when available (plaintext `data.json` fallback on older Obsidian), and the Project ID prefills from the key.
4. Reconnect — the status row shows "Connected" with the access-token expiry once the first token exchange succeeds.

**Requires agent mode.** GCP tools ride the same loop and `agentMaxTurns` cap as the other agent tools.

## Tools

| Tool | Description | Parameters |
|---|---|---|
| `gcp__storage__list_buckets` | Buckets in the configured project | `max_results`, `page_token` |
| `gcp__storage__list_objects` | Objects in a bucket, optionally under a prefix | `bucket` (required), `prefix`, `max_results`, `page_token` |
| `gcp__storage__read_object` | One object — text-like files inline (capped at 20,000 characters); binaries return metadata only | `bucket` (required), `object` (required) |

Tool names carry the `gcp__` prefix, so they never collide with vault or MCP tools. Like MCP tools, per-agent tool ceilings can turn GCP off for individual named agents (Agents editor → Tool access).

## Auth model

Curtis signs a JWT with the key's RSA private key (WebCrypto — works on desktop and mobile) and exchanges it at Google's OAuth2 token endpoint for a short-lived access token (about an hour), cached and refreshed automatically. The requested scope is `devstorage.read_only` — least privilege; the credentials Curtis holds cannot write to your buckets.

**Privacy:** requests go to `storage.googleapis.com` with your key's credentials. Object contents travel through your AI provider like any other tool result. The key file never leaves your device except in the token-exchange request Google itself defines.

## Out of scope (v1)

- Writes of any kind — no upload, update, or delete.
- Services beyond Cloud Storage — BigQuery, Cloud Logging, and Vertex AI Search are candidates for later connectors.
- Binary content is never inlined; the model sees content type, size, and URI only.
