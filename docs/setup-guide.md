# Setup and deployment guide

## 1. Local verification

```bash
npm install
npm run check
npm test
SITE_MODE=static npx quartz build
```

Node.js 22+ and npm 10.9+ are required.

## 2. Configure public URLs

Set `SITE_URL` during builds:

```bash
SITE_URL=docs.example.com npx quartz build
```

Do not include a path. If omitted, canonical and absolute social URLs are omitted rather than generated from a placeholder domain.

## 3. Static deployment

For Cloudflare Pages or EdgeOne Pages:

```text
Build command: npx quartz build
Output: public
Node: 22
Environment: SITE_MODE=static, SITE_URL=<final host>
```

Cloudflare-compatible hosts copy `quartz/static/_headers` into the output. Verify the headers on the final hostname.

GitHub Pages uses `.github/workflows/pages.yaml` and is disabled until repository variable `ENABLE_GITHUB_PAGES=true` is set.

## 4. Collab deployment

Create a Supabase project and apply every migration in numeric order:

```text
001_initial_schema.sql
002_user_sync_and_rls_patch.sql
003_annotations_schema_update.sql
004_security_and_content_constraints.sql
005_collab_membership_and_named_equipment.sql
```

Configure GitHub OAuth in Supabase, including the final callback URLs. Then build with:

```bash
SITE_MODE=collab \
SITE_URL=docs.example.com \
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your-public-anon-key \
npx quartz build
```

Never expose a service-role key. The anon key is public; RLS is the security boundary.

### Existing databases

Back up first, then apply only migrations newer than those already applied. Migration `004` changes View execution, revokes anonymous View access, hides member email from browser roles and adds content constraints.

### Required production probes

Use direct Data API calls to verify:

- anonymous users cannot read collaboration Views or tables;
- members cannot read `users.email`;
- members can only mutate their own comments/annotations/reservations;
- ordinary users cannot promote themselves to admin;
- administrator delete policies work as intended.

If any result is uncertain, do not expose Collab Mode publicly.

## 5. Mainland/offline checklist

Supabase JS is bundled locally and each theme loads only its own font stylesheet. A strict mainland/offline build still needs:

- self-hosted theme fonts and their license files;
- replacement of any third-party images in your own content;
- a mainland-appropriate database/backend if Supabase latency or availability is unacceptable.

Do not advertise “fully mainland/offline ready” until a built-site external-host scan returns only approved origins.

## 6. Upgrades

Configure the product update remote explicitly:

```bash
git remote add cfour <YOUR-CFOUR-REPOSITORY-URL>
npx quartz update
```

Review the resulting diff and rerun both mode builds. Quartz upstream changes are not pulled automatically; test them as a separate maintenance task.
