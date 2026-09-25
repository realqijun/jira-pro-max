# ADR 0011: Per-User Assistant provider credentials

## Status

Accepted.

## Context

Different Users may need the Assistant to use OpenAI, Anthropic, Google Gemini, or an OpenAI-compatible endpoint with different models and accounts.
Deployment environment variables remain useful as an operator-managed default, but cannot express per-User ownership.
Provider credentials are high-value secrets, and custom endpoints create server-side request forgery risk.

## Decision

Each User may own one `user_ai_configs` row.
It is an Assistant-owned record rather than a Project item, so writes do not create Activity Events.
The User ID is both its primary key and its authorization scope, and deletion cascades with the User.

A personal configuration always takes precedence over the environment fallback.
Unreadable personal credentials fail closed rather than sending User data to a different provider.
Explicitly removing the row restores the environment fallback.

API keys are encrypted with AES-256-GCM using a random nonce, versioned ciphertext, and the User ID as authenticated data.
Deployments must supply a base64-encoded 32-byte `AI_CREDENTIALS_ENCRYPTION_KEY`; there is no default.
Only a safe summary crosses the server boundary, and the saved key is never rendered again.

A new key is required for the first save and whenever the provider changes.
A blank key preserves the existing credential only for the same provider.
Before persistence, the server makes a small, bounded generation request with no retries and returns a sanitized failure.

OpenAI-compatible endpoints must use public HTTPS without credentials, a query, or fragment.
The application rejects localhost, IP literals, private, link-local, documentation, multicast, and reserved address ranges.
It repeats URL and DNS checks at request time through a no-redirect fetch adapter to reduce DNS rebinding and redirect bypass risk.

## Consequences

Key rotation for `AI_CREDENTIALS_ENCRYPTION_KEY` requires an explicit migration because existing ciphertext is bound to that key.
Model names remain free-form so provider catalog changes do not require application releases.
Validation can incur a minimal provider charge and proves only reachability, authentication, model access, and basic generation.
Normal Assistant use may still fail if the selected model does not support required tool behavior.
