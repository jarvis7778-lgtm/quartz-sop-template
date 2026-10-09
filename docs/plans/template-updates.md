# Template update implementation plan

**Status:** Implemented locally; real Release/PR/deployment verification is the release gate. See `../template-updates.md` for the supported first-version workflow and limits.

> **For Hermes:** Use subagent-driven-development for bounded implementation; parent verifies real behavior and integration.

**Goal:** Release-based, reviewable updates preserving downstream content/configuration, shared by template and showcase.

**Architecture:** A fixed managed-core allowlist plus SHA-256 baseline lock separates core from user assets without disruptive repo relocation. A scheduled/manual GitHub Action resolves the latest stable upstream Release to an immutable commit, prepares an update branch, validates build and opens a PR. No automatic merge, production DB changes or writes from public browser scripts. Initial adoption uses an explicitly verified upstream baseline; divergence blocks rather than overwrites. Showcase is first downstream user.

**Tech Stack:** Node built-ins, Git, GitHub Actions/gh, existing Quartz builds.

## 1. Core updater (child; TDD)

Create scripts/core-update.mjs and scripts/core-update.test.mjs. Define fixed managed scope: quartz code excluding quartz/styles/custom.scss and quartz/static/**; themes/**; package.json/package-lock.json and build type infrastructure; updater script itself. Never manage content, site.\* configs, quartz.config/layout, custom styles/static assets, env, DB, user workflows or docs. Snapshot hashes in .template/core-lock.json. Init only from known baseline and refuse local core divergence. Apply calculates all adds/changes/deletes before writing; conflicts/hash/path/symlink issues fail before modifications. Preserve unrelated files. Report migrations separately and never execute SQL. Tests use temporary real directory trees, include conflict no-partial-write, removal, idempotence, preservation, symlinks/traversal.

## 2. Release/PR workflow (parent)

Create .github/workflows/template-update.yaml and scripts/check-template-update.mjs. Use official upstream constant, stable releases only, validate vX.Y.Z tags, resolve commit from git remote, checkout that commit. Compare versions, never downgrade. Produce status summary even unchanged/blocked. For an update, run tsc and static build before push/PR; token never available during dependency install/build (separate jobs, validated artifact). PR is the update notification. Set contents/PR permissions explicitly. Keep generated PR branch stable per release without overwriting human edits. Document GITHUB_TOKEN PR workflows not automatically triggered; run validation in updater and final production build in Pages on human merge. Pages must build successfully before uploading/deploying.

## 3. Adoption/showcase integration (parent)

Read local showcase history, identify baseline source revision, hash user assets before/after. Preserve all user-facing content/config/static/custom CSS. Any previously customized core reports conflict. Do not forcibly initialize against current downstream files. Add same update workflow and baseline lock to both repos, apply current local candidate to showcase and actually build. If core differs from baseline inspect and preserve via explicitly reviewed migration, never silently reset. Version candidate must be marked unpublished; no fake GitHub Release. Existing update migration docs explain manual DB migration and owner-managed configs.

## 4. Verification/handoff

Run updater regression, deterministic release-check fixtures, malicious tag/path/modified core tests, npm check/test/build, showcase real build and browser theme/navigation smoke. Test bad build never reaches PR/publication. Independently review workflow permission/artifact boundaries. Write Chinese operator/update docs covering setup, notification/merge, manual adoption for old repos, custom core conflict, backup Git history/revert, release procedure and DB separation. Explicitly report local verification vs not-run GitHub Actions/real Release. No push, release or live deployment this turn.
