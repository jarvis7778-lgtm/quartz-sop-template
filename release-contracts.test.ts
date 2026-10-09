import test, { describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateSiteFeatureConfig } from "./site.features"
import { createThemePreset } from "./themes"

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), "utf8")

describe("release contracts", () => {
  test("database views execute with the caller and are not granted to anonymous users", () => {
    const sql = read("supabase/migrations/001_initial_schema.sql")
    for (const view of ["comments_with_author", "reservations_with_user"]) {
      assert.match(sql, new RegExp(`CREATE VIEW ${view}\\s+WITH \\(security_invoker = true\\)`))
      assert.match(sql, new RegExp(`REVOKE ALL ON ${view} FROM anon`))
    }
  })

  test("database baseline enforces bounded user content", () => {
    const sql = read("supabase/migrations/001_initial_schema.sql")
    assert.match(sql, /char_length\(content\) BETWEEN 1 AND 5000/i)
    assert.match(sql, /char_length\(title\) BETWEEN 1 AND 200/i)
  })

  test("annotation migration drops legacy policies before removing author_id", () => {
    const sql = read("supabase/migrations/003_annotations_schema_update.sql")
    const dropPolicy = sql.indexOf('DROP POLICY IF EXISTS "成员可创建注释"')
    const dropColumn = sql.indexOf("DROP COLUMN IF EXISTS author_id")
    assert.ok(dropPolicy >= 0 && dropPolicy < dropColumn)
  })

  test("theme preset changes trigger consumers that use themechange", () => {
    const script = read("quartz/components/scripts/themeswitcher.inline.ts")
    assert.match(script, /new CustomEvent\("themepresetchange"/)
    assert.match(script, /new CustomEvent\("themechange"/)
  })

  test("feature validation rejects database features without a client bootstrap", () => {
    assert.throws(
      () =>
        validateSiteFeatureConfig({
          mode: "static",
          features: { auth: false, comments: false, annotations: false, reservations: true },
        }),
      /auth|Supabase/i,
    )
  })

  test("unknown theme ids fail closed instead of silently mixing presets", () => {
    assert.throws(() => createThemePreset("does-not-exist"), /unknown theme preset/i)
  })

  test("every registered theme stylesheet is included in the Sass entrypoint", () => {
    const themes = read("themes/index.ts")
    const customScss = read("quartz/styles/custom.scss")
    const ids = [...themes.matchAll(/from "\.\/presets\/([^/]+)\/theme"/g)].map((match) => match[1])
    assert.equal(ids.length, 8)
    for (const id of ids) {
      assert.match(customScss, new RegExp(`themes/presets/${id}/theme`))
    }
  })

  test("initial HTML only blocks on the configured preset font", () => {
    const head = read("quartz/components/Head.tsx")
    assert.match(head, /allPresetsGoogleFontHref\(\[activeManifest\]\)/)
    assert.doesNotMatch(head, /allPresetsGoogleFontHref\(themeRegistry\)/)
  })

  test("CI covers the repository default branch and both site modes", () => {
    const ci = read(".github/workflows/ci.yaml")
    assert.match(ci, /- master/)
    assert.match(ci, /matrix:/)
    assert.match(ci, /static/)
    assert.match(ci, /collab/)
  })

  test("the public template does not default to analytics or placeholder production URLs", () => {
    const config = read("quartz.config.ts")
    const pkg = read("package.json")
    assert.match(config, /analytics:\s*null/)
    assert.doesNotMatch(config, /your-site\.pages\.dev/)
    assert.doesNotMatch(pkg, /your-org/)
    assert.doesNotMatch(pkg, /cfour-dev\/cfour/)
  })

  test("the update command does not silently pull the Quartz upstream", () => {
    const handlers = read("quartz/cli/handlers.js")
    const updateStart = handlers.indexOf("export async function handleUpdate")
    const restoreStart = handlers.indexOf("export async function handleRestore")
    const updateHandler = handlers.slice(updateStart, restoreStart)
    assert.doesNotMatch(updateHandler, /jackyzha0\/quartz\.git/)
    assert.doesNotMatch(updateHandler, /git remote add cfour/)
    assert.match(updateHandler, /gitPull\(["']cfour["'],\s*["']main["']\)/)
  })

  test("default math resources are bundled rather than fetched from jsDelivr", () => {
    const latex = read("quartz/plugins/transformers/latex.ts")
    assert.doesNotMatch(latex, /cdn\.jsdelivr\.net\/npm\/katex/)
    assert.match(latex, /static\/katex\/katex\.min\.css/)
  })
})

describe("collaboration lifecycle contracts", () => {
  test("auth and comments are SPA-aware and clean up auth subscriptions", () => {
    for (const file of ["quartz/components/Auth.tsx", "quartz/components/SupaComments.tsx"]) {
      const source = read(file)
      assert.match(source, /addEventListener\(['"]nav['"]/)
      assert.match(source, /addCleanup/)
      assert.match(source, /unsubscribe/)
    }
  })

  test("comment writes inspect Supabase errors before clearing user input", () => {
    const comments = read("quartz/components/SupaComments.tsx")
    assert.match(
      comments,
      /const \{ error \} = await client\.from\('comments'\)\.insert[\s\S]*if \(error\) throw error/,
    )
    assert.match(
      comments,
      /const \{ error \} = await client\.from\('comments'\)\.delete[\s\S]*if \(error\) throw error/,
    )
  })

  test("collaboration code does not load the Supabase SDK from jsDelivr", () => {
    for (const file of ["quartz/components/Auth.tsx", "quartz/components/SupaComments.tsx"]) {
      assert.doesNotMatch(read(file), /cdn\.jsdelivr\.net\/npm\/@supabase/)
    }
  })
})
