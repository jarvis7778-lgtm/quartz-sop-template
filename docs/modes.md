# Static and Collab Modes

The same source tree can be built in two validated modes through `SITE_MODE`.

## Static Mode

```bash
SITE_MODE=static SITE_URL=docs.example.com npx quartz build
```

This is the default and requires no database. Auth, comments, annotations and reservations are absent from the generated site.

## Collab Mode

```bash
SITE_MODE=collab \
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your-public-anon-key \
SITE_URL=docs.example.com \
npx quartz build
```

Collab Mode adds GitHub OAuth, comments, text annotations and reservations. Apply all SQL migrations in numeric order for a new database. Existing databases apply only newer migration numbers after taking a backup.

The Supabase client is a global locally bundled prescript, independent of the visible Auth component. The shipped presets nevertheless keep the collaboration features together because each feature needs a signed-in user and shared authorization policy.

## Custom feature mixes

Feature dependencies are validated at build time. Database-backed features currently require `auth: true`:

```ts
validateSiteFeatureConfig({
  mode: "collab",
  features: {
    auth: true,
    comments: false,
    annotations: false,
    reservations: true,
  },
})
```

A configuration such as `auth: false, reservations: true` fails the build instead of waiting in the browser and silently showing “not configured”.

## Production boundary

GitHub OAuth authenticates identity; migration `005` separately requires explicit membership approval. New identities and legacy non-admins are pending until approved. Read `docs/collab-security-upgrade.md` for administrator bootstrap and recovery. For a private team site, protect static HTML, attachments, indexes and every preview URL using edge access control as well. Test anonymous, pending, approved, revoked and administrator identities against the Data API before launch.
