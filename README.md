# cfour

A theme-rich SOP and personal knowledge-site template built on Quartz 4. One static build contains eight runtime-switchable visual presets. It defaults to a backend-free Static Mode and can optionally enable Supabase collaboration.

## What ships

- Markdown/Obsidian authoring under `content/`
- Search, backlinks, navigation, dark mode, reader mode, RSS and sitemap
- Eight runtime themes: `current`, `notion`, `things`, `anuppuccin`, `bluetopaz`, `carbon`, `nocturne`, `fieldnotes`
- Optional GitHub login, comments, text annotations and reservation calendar
- Cloudflare Pages/EdgeOne/static-host output plus an opt-in GitHub Pages workflow

## Quick start

Requirements: Node.js 22+ and npm 10.9+.

```bash
npm install
npm run dev
```

Open <http://localhost:8081>.

## Build modes

Static Mode is the default:

```bash
SITE_MODE=static SITE_URL=docs.example.com npx quartz build
```

Collab Mode:

```bash
SITE_MODE=collab \
SITE_URL=docs.example.com \
SUPABASE_URL="https://your-project.supabase.co" \
SUPABASE_ANON_KEY="your-public-anon-key" \
npx quartz build
```

`SITE_URL` must omit the path and may include or omit `https://`. If it is absent, cfour omits canonical/social absolute URLs instead of publishing a placeholder domain. Analytics are disabled by default.

## Collab database

### New installation

Apply every migration in numeric order:

```text
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_user_sync_and_rls_patch.sql
supabase/migrations/003_annotations_schema_update.sql
supabase/migrations/004_security_and_content_constraints.sql
supabase/migrations/005_collab_membership_and_named_equipment.sql
```

Migration `005` requires explicit membership approval and makes named resources exclusive. Existing non-admin members become pending; existing overlapping bookings block migration without deleting data. Read [the upgrade and recovery guide](docs/collab-security-upgrade.md) before applying it.

Do not stop after `001`: the later migrations upgrade annotation anchors, protect member email columns, make public views obey RLS, and add content limits.

### Existing installation

Apply only migration numbers newer than the last migration already applied. Back up the database first. Migration `004` is the security patch for existing installations.

Before production, test the Data API with `anon`, ordinary authenticated, and admin identities. Collab Mode requires approved members (migration `005`). Protect private HTML, attachments, search indexes and preview URLs with an edge allowlist as well; an edge login does not replace database membership policies.

## Themes

Choose only the first-visit default in `site.theme.ts`:

```ts
export const siteTheme: { preset: ThemePresetName } = {
  preset: "carbon",
}
```

Visitors can switch all eight themes at runtime. The choice persists across reloads and Quartz SPA navigation. Only the default preset's Google Fonts stylesheet blocks first paint; other theme fonts load when selected. Theme changes also emit the normal `themechange` event so Mermaid and Graph redraw with the new tokens.

New themes require:

1. `themes/presets/<id>/theme.ts`
2. `themes/presets/<id>/theme.scss`
3. a manifest import/entry in `themes/index.ts`
4. a Sass `@use` entry in `quartz/styles/custom.scss`

The release-contract test checks that all registered presets have Sass entrypoints. See [`docs/themes.md`](./docs/themes.md).

### Build the eight-theme showcase

```bash
npm run build:showcase
node serve-previews.mjs
```

This performs one Quartz build and creates eight showcase entry directories; it does not rewrite `site.theme.ts` or run eight compiles.

## Deployment

### Cloudflare Pages or EdgeOne Pages

```text
Build command:  npx quartz build
Output:         public
Node:           22
```

Set `SITE_MODE` and `SITE_URL`; add the two public Supabase variables only for Collab Mode. `quartz/static/_headers` supplies baseline security headers on hosts that support the Cloudflare `_headers` format. EdgeOne can use the same static build/output settings; verify any platform-specific header rules in its console.

### GitHub Pages

The opt-in workflow is `.github/workflows/pages.yaml`.

1. Set repository variable `ENABLE_GITHUB_PAGES=true`.
2. Set `SITE_URL` to the final Pages/custom domain.
3. Enable GitHub Pages with **GitHub Actions** as source.

For project sites served below `/repository/`, use a custom domain or verify Quartz base-path behavior before production OAuth. Collab OAuth redirects preserve the current page path.

## Updating

`npx quartz update` no longer silently pulls Quartz upstream. It only updates from a remote named `cfour` and fails closed when that remote is absent:

```bash
git remote add cfour <YOUR-CFOUR-REPOSITORY-URL>
npx quartz update
```

Use the actual repository that publishes your cfour distribution. Keep content/config changes in your own commits and review update diffs before merging. Quartz upstream upgrades should be tested separately rather than mixed into an unattended template update.

## Verification

```bash
npm run check
npm test
npm run test:db # requires Docker
SITE_MODE=static npx quartz build
SITE_MODE=collab SUPABASE_URL=https://example.supabase.co SUPABASE_ANON_KEY=public-anon-placeholder npx quartz build
npm audit --omit=dev
```

## Privacy and China-readiness

- Supabase JS and Mermaid are bundled locally; cfour no longer needs jsDelivr or cdnjs for them.
- Theme fonts remain Google Fonts by default, but are loaded per preset rather than all at once. KaTeX, Mermaid and Supabase JS are bundled locally. For a strict mainland/offline deployment, self-host fonts and retain their license files.
- Replace example content and all third-party image URLs before publishing.
- Never commit `.env`, secrets, private screenshots, or service-role keys. The anon key is public by design; authorization must remain in RLS.
- Analytics are opt-in, not enabled by default.

## License

Quartz's upstream MIT notice remains in [`LICENSE.txt`](./LICENSE.txt). See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for attribution and theme/font guidance.
