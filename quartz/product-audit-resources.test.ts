import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import test, { after } from "node:test"
import os from "node:os"

const projectRoot = path.resolve(import.meta.dirname, "..")
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "sop-resources-test-"))
const output = path.join(workspace, "output")
const input = path.join(workspace, "content")
fs.mkdirSync(path.join(input, "sop"), { recursive: true })
fs.writeFileSync(path.join(input, "index.md"), "---\ntitle: Test site\n---\n# Test site\n")
fs.writeFileSync(
  path.join(input, "sop", "theme-showcase.md"),
  "---\ntitle: Diagram fixture\n---\n# Diagram fixture\n\n```mermaid\nflowchart LR\n A --> B\n```\n",
)
after(() => fs.rmSync(workspace, { recursive: true, force: true }))

function buildSite(env: NodeJS.ProcessEnv) {
  fs.rmSync(output, { recursive: true, force: true })
  execFileSync(
    process.execPath,
    [
      "./quartz/bootstrap-cli.mjs",
      "build",
      "--directory",
      input,
      "--output",
      output,
      "--concurrency",
      "1",
    ],
    { cwd: projectRoot, env: { ...process.env, SITE_MODE: "static", ...env }, stdio: "pipe" },
  )
}

test("a configured site domain emits complete SEO URLs and valid image MIME types", () => {
  buildSite({
    SITE_URL: "docs.example.test",
    GITHUB_SHA: "123456789abc000000000000000000000000000000",
  })

  const page = fs.readFileSync(path.join(output, "index.html"), "utf8")
  assert.match(page, /postscript\.js\?v=123456789abc/)
  assert.match(page, /index\.css\?v=123456789abc/)
  const sitemap = fs.readFileSync(path.join(output, "sitemap.xml"), "utf8")
  const feed = fs.readFileSync(path.join(output, "index.xml"), "utf8")

  assert.match(page, /https:\/\/docs\.example\.test\/static\/og-image\.png/)
  assert.doesNotMatch(page, /image\/\.png/)
  assert.doesNotMatch(sitemap, /undefined/)
  assert.doesNotMatch(feed, /undefined/)
  assert.match(
    page,
    /rel="alternate"[^>]*application\/rss\+xml[^>]*href="https:\/\/docs\.example\.test\/index\.xml"/,
  )
})

test("a missing site domain does not emit undefined OG, RSS, or sitemap URLs", () => {
  buildSite({ SITE_URL: "" })

  const page = fs.readFileSync(path.join(output, "index.html"), "utf8")
  assert.doesNotMatch(page, /undefined|image\/\.png/)
  assert.ok(!fs.existsSync(path.join(output, "sitemap.xml")))
  assert.ok(!fs.existsSync(path.join(output, "index.xml")))
})

test("Mermaid is emitted as a local dynamic chunk only on diagram pages", () => {
  buildSite({
    SITE_URL: "docs.example.test",
    GITHUB_SHA: "123456789abc000000000000000000000000000000",
  })

  const plainPage = fs.readFileSync(path.join(output, "index.html"), "utf8")
  const diagramPage = fs.readFileSync(path.join(output, "sop", "theme-showcase.html"), "utf8")
  const mermaidEntry = path.join(output, "static", "mermaid.js")

  assert.ok(fs.existsSync(mermaidEntry), "expected a local Mermaid entry module")
  assert.doesNotMatch(plainPage, /mermaid\.js/)
  assert.ok(Buffer.byteLength(plainPage) < 100_000, "plain page must not inline the renderer")
  assert.match(diagramPage, /name="mermaid-module" content="\.\.\/static\/mermaid\.js"/)
  assert.ok(fs.statSync(mermaidEntry).size > 1_000)
})
