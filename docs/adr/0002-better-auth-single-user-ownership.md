---
status: accepted
---

# Better Auth with email/password; a User owns Projects outright

Authentication uses Better Auth (sessions and users in our own Postgres via the Drizzle adapter) rather than Auth.js or a hosted provider. Auth.js discourages the credentials flow we need for a course demo; a hosted provider adds a dashboard and lock-in for no benefit at this scale.

Tenancy is deliberately single-user: every Project has one owning User and nothing is shared. The future Health Briefing is per-PM, so Users must exist, but collaboration and permissions are a scope trap for the assignment. People who do the work are modelled as `Person` records inside a Project, not as Users, so the model does not require them to have accounts.

## Consequences

- Adding sharing later means introducing a `Workspace`/membership table between User and Project; all authorization checks are centralised in the service layer's `assertOwnsProject` so that is a single seam.
- Google sign-in was added later as a Better Auth social provider, on only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
  It creates an ordinary User, so ownership and the sample Project (ADR 0013) are unchanged.
  A Google login whose email already belongs to a password account is refused, not linked: emails are never verified here, so linking would let whoever registered an address first keep a password into its owner's account.
