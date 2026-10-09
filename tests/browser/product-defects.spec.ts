import { test, expect } from "@playwright/test"
import { build } from "esbuild"

test("math fonts are served locally on nested pages", async ({ page }) => {
  const failed: string[] = []
  const fonts: string[] = []
  page.on("response", (response) => {
    if (/KaTeX.*woff/.test(response.url())) {
      fonts.push(response.url())
      if (response.status() >= 400) failed.push(response.url())
    }
  })
  await page.goto("/sop/theme-showcase")
  await page.locator(".katex").first().scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator(".katex").first()).toBeVisible()
  expect(fonts.length).toBeGreaterThan(0)
  expect(failed).toEqual([])
})

test("Mermaid loads only on demand and renders across SPA visits", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await page.goto("/")
  expect(requests.filter((url) => /static\/mermaid/.test(url))).toHaveLength(0)
  await page.locator('a[href*="theme-showcase"]').last().click()
  await expect(page).toHaveURL(/theme-showcase/)
  await expect(page.locator("code.mermaid svg").first()).toBeVisible()
  await page.locator(".theme-switcher-button").click()
  await page.locator('[data-theme-value="carbon"]').click()
  await expect(page.locator("code.mermaid svg").first()).toBeVisible()
  await page.goto("/sop/theme-showcase")
  await expect(page.locator("code.mermaid svg").first()).toBeVisible()
})

const presets = [
  "current",
  "notion",
  "things",
  "anuppuccin",
  "bluetopaz",
  "carbon",
  "nocturne",
  "fieldnotes",
]

for (const preset of presets) {
  test(`${preset}: mobile page fits the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await page.locator(".theme-switcher-button").click()
    await page.locator(`[data-theme-value="${preset}"]`).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme-preset", preset)
    const sizes = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
  })
}

test("theme fonts survive reload and SPA navigation", async ({ page }) => {
  await page.goto("/")
  await page.locator(".theme-switcher-button").click()
  await page.locator('[data-theme-value="carbon"]').click()
  const font = await page.locator("#theme-fonts").getAttribute("href")
  expect(font).toContain("IBM")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme-preset", "carbon")
  await expect(page.locator("#theme-fonts")).toHaveAttribute("href", font!)
  await page.locator('article a[href*="example-onboarding"]').click()
  await expect(page).toHaveURL(/example-onboarding/)
  await expect(page.locator("#theme-fonts")).toHaveAttribute("href", font!)
})

test("mobile menu has an accessible name", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.locator(".mobile-explorer")).toHaveAccessibleName(/\S/)
  await page.locator(".mobile-explorer").click()
  await expect(page.locator(".mobile-explorer")).toHaveAttribute("aria-expanded", "true")
  await page.keyboard.press("Escape")
  await expect(page.locator(".mobile-explorer")).toHaveAttribute("aria-expanded", "false")
})

test("hidden mobile Explorer never locks content on viewport resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.locator(".sidebar.left").evaluate((el) => {
    ;(el as HTMLElement).style.display = "none"
  })
  await page.locator(".explorer").evaluate((el) => el.classList.remove("collapsed"))
  await page.setViewportSize({ width: 390, height: 760 })
  await expect(page.locator("#quartz-body")).not.toHaveClass(/lock-scroll/)
  await expect(page.locator("html")).not.toHaveClass(/mobile-no-scroll/)
})

test("sample article has one page heading", async ({ page }) => {
  await page.goto("/sop/example-onboarding")
  await expect(page.locator("h1")).toHaveCount(1)
})

test("static homepage does not advertise inactive reservation links", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator('article a[href*="calendar"]')).toHaveCount(0)
  await expect(page.locator('.explorer a[href*="calendar"]')).toHaveCount(0)
})

test("comments expose a working manual refresh without claiming realtime", async ({ page }) => {
  const fixture = await build({
    stdin: {
      contents: `import factory from './quartz/components/SupaComments'; import render from 'preact-render-to-string'; const Component = factory(); window.commentFixture = {html: render(Component({fileData:{slug:'sop/test',frontmatter:{}},displayClass:undefined})),script:Component.afterDOMLoaded};`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
  })
  await page.goto("/")
  await page.addScriptTag({ content: fixture.outputFiles[0].text })
  await page.evaluate(() => {
    const w = window as any
    const box = document.createElement("div")
    box.innerHTML = w.commentFixture.html
    document.body.append(box)
    w.commentLoads = 0
    w.membership = "approved"
    w.readCollaborationMembership = async () => w.membership
    w.collaborationMembershipMessage = {
      pending: "等待管理员批准",
      revoked: "协作权限已撤销",
      unavailable: "无法验证协作权限",
    }
    w.supabaseClientReady = Promise.resolve({
      auth: {
        getSession: async () => ({ data: { session: { user: { id: "member" } } } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from: () => {
        const query: any = {
          single: async () => ({ data: { id: "member", role: "member" } }),
          select: () => query,
          eq: () => query,
          is: () => query,
          order: async () => {
            w.commentLoads++
            return { data: [], error: null }
          },
        }
        return query
      },
    })
    const script = document.createElement("script")
    script.textContent = w.commentFixture.script
    document.body.append(script)
  })
  await expect.poll(() => page.evaluate(() => (window as any).commentLoads)).toBe(1)
  await page.getByRole("button", { name: "刷新评论" }).click()
  await expect.poll(() => page.evaluate(() => (window as any).commentLoads)).toBe(2)
  await expect(page.locator("#supa-comments")).toContainText("刷新后同步")
  await page.evaluate(() => {
    ;(window as any).membership = "revoked"
  })
  await page.getByRole("button", { name: "刷新评论" }).click()
  await expect(page.locator("#comments-login-prompt")).toContainText("协作权限已撤销")
  await expect(page.locator("#comments-input-area")).toBeHidden()
  expect(await page.evaluate(() => (window as any).commentLoads)).toBe(2)
})

test("orphaned annotation is visibly marked for relocation", async ({ page }) => {
  const bundled = await build({
    entryPoints: ["quartz/components/scripts/annotation/sidebar.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "sidebar",
  })
  await page.goto("/")
  await page.addScriptTag({ content: bundled.outputFiles[0].text })
  await page.evaluate(() => {
    const element = document.createElement("div")
    element.id = "annotation-sidebar-list"
    document.body.append(element)
    ;(window as any).sidebar.renderSidebar([
      {
        id: "missing",
        quote: "Removed text",
        note: "Keep this note",
        user_id: "member",
        created_at: new Date().toISOString(),
      },
    ])
  })
  await expect(page.locator('[data-ann-card-id="missing"]')).toContainText("需要重新定位")
})

test("annotation anchors reject changed or ambiguous text", async ({ page }) => {
  const bundled = await build({
    entryPoints: ["quartz/components/scripts/annotation/anchor.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "anchors",
  })
  await page.goto("/")
  await page.addScriptTag({ content: bundled.outputFiles[0].text })
  const result = await page.evaluate(() => {
    const api = (window as any).anchors
    const root = document.createElement("article")
    root.innerHTML = "<p>wrong words</p><p>correct quote</p>"
    document.body.append(root)
    const anchor = {
      startContainer: "p:nth-of-type(1)::text(0)",
      endContainer: "p:nth-of-type(1)::text(0)",
      startOffset: 0,
      endOffset: 13,
      text: "correct quote",
    }
    const moved = api.deserializeAnchor(anchor, root)?.toString()
    root.innerHTML = "<p>wrong words</p><p>correct quote</p><p>correct quote</p>"
    const ambiguous = api.deserializeAnchor(anchor, root)
    root.innerHTML = "<p>wrong words</p><p>correct\n  <b>quote</b></p>"
    const whitespace = api.deserializeAnchor(anchor, root)?.toString().replace(/\s+/g, " ")
    root.innerHTML = "<p>wrong words</p><p>correct other quote</p>"
    const removed = api.deserializeAnchor(anchor, root)
    root.remove()
    return { moved, ambiguous: ambiguous === null, whitespace, removed: removed === null }
  })
  expect(result).toEqual({
    moved: "correct quote",
    ambiguous: true,
    whitespace: "correct quote",
    removed: true,
  })
})
