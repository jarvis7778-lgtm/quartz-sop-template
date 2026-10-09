/**
 * 文本批注系统 - 客户端入口
 *
 * 这个文件会被 Quartz 的 esbuild 打包成一个 browser bundle，
 * 作为 Annotation 组件的 afterDOMLoaded 脚本。
 *
 * 功能：
 * - 在 SOP 文档页面（非 /calendar）上启用文本高亮批注
 * - 选中文本 → 显示 "批注" 按钮 → 输入备注 → 保存
 * - 加载并显示已有批注（高亮 + 侧边栏卡片）
 */

import type { Annotation, SupabaseClient } from "./annotation/types"
import { getArticleRoot } from "./annotation/anchor"
import { readMembership, membershipMessage } from "./membership"
import { fetchAnnotations, getCurrentUserId } from "./annotation/data"
import { applyAllHighlights, clearAllHighlights } from "./annotation/highlight"
import { initSelection } from "./annotation/selection"
import {
  initSidebar,
  renderSidebar,
  clearSidebar,
  setCurrentUserId,
  setActiveCard,
  realignCards,
} from "./annotation/sidebar"
import { initAnnotationRealtime } from "./annotation/realtime"

/** 是否应该在当前页面启用批注 */
function shouldEnable(): boolean {
  // 排除 calendar 页面
  if (document.getElementById("reservation-calendar")) return false

  // 需要有 article 元素
  const article = getArticleRoot()
  if (!article) return false

  // 排除 404、标签列表等非内容页
  const slug = getCurrentSlug()
  if (!slug || slug === "404") return false

  return true
}

/** 获取当前页面 slug */
function getCurrentSlug(): string {
  return normalizePageSlug(window.location.pathname)
}

/** 规范化页面 slug（前后端统一：去前后 /、去 .html、空值→index） */
function normalizePageSlug(input: string): string {
  let slug = input.replace(/^\/+|\/+$/g, "")
  slug = slug.replace(/\.html$/, "")
  return slug || "index"
}

/** 客户端由全局 prescript 本地打包并初始化。 */
async function waitForSupabase(): Promise<SupabaseClient | null> {
  return ((window as any).supabaseClientReady ??
    Promise.resolve(null)) as Promise<SupabaseClient | null>
}

/** 清理函数集合 */
let cleanupFns: Array<() => void> = []
/** 初始化代次（用于丢弃过期异步回调） */
let initRunToken = 0

function addLocalCleanup(fn: () => void) {
  cleanupFns.push(fn)
}

function runCleanup() {
  for (const fn of cleanupFns) {
    try {
      fn()
    } catch (e) {
      console.warn("[annotation] cleanup error:", e)
    }
  }
  cleanupFns = []
}

function isStaleRun(runToken: number): boolean {
  return runToken !== initRunToken
}

function canScrollY(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 1
}

function scrollElementByDelta(el: HTMLElement, deltaY: number): boolean {
  const before = el.scrollTop
  el.scrollTop += deltaY
  return el.scrollTop !== before
}

/**
 * 右侧滚轮行为：
 * - 目录内部：仅滚目录
 * - 目录外部：滚右侧整列
 */
function initRightSidebarWheelProxy(): () => void {
  if (window.innerWidth < 1200) return () => {}

  const sidebar = document.querySelector(".sidebar.right") as HTMLElement | null
  if (!sidebar) return () => {}

  const onWheel = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null
    if (!target) return

    // 鼠标在批注列表内时，交给批注列表自身滚动
    const annotationScrollable = target.closest(
      ".annotation .annotation-sidebar-list",
    ) as HTMLElement | null
    if (annotationScrollable && canScrollY(annotationScrollable)) return

    // 鼠标在目录内时，交给目录自身滚动
    const tocScrollable = target.closest(".toc .toc-content.overflow") as HTMLElement | null
    if (tocScrollable && canScrollY(tocScrollable)) return

    e.preventDefault()

    // 目录外：优先滚右侧整列
    if (canScrollY(sidebar) && scrollElementByDelta(sidebar, e.deltaY)) return

    // 整列不可滚时，兜底滚批注列表
    const fallbackAnnotation = sidebar.querySelector(
      ".annotation .annotation-sidebar-list",
    ) as HTMLElement | null
    if (
      fallbackAnnotation &&
      canScrollY(fallbackAnnotation) &&
      scrollElementByDelta(fallbackAnnotation, e.deltaY)
    )
      return

    // 整列不可滚时，兜底滚目录，避免右侧“死区”
    const fallbackToc = sidebar.querySelector(".toc .toc-content.overflow") as HTMLElement | null
    if (fallbackToc && canScrollY(fallbackToc) && scrollElementByDelta(fallbackToc, e.deltaY))
      return

    // 最后兜底滚页面
    window.scrollBy({ top: e.deltaY, behavior: "auto" })
  }

  sidebar.addEventListener("wheel", onWheel, { passive: false })
  return () => {
    sidebar.removeEventListener("wheel", onWheel as EventListener)
  }
}

/** 移动端：显示注释详情底部弹窗 */
function showMobileAnnotationSheet(ann: Annotation): void {
  // 移除已有的弹窗
  const existing = document.getElementById("ann-mobile-sheet")
  if (existing) existing.remove()

  const sheet = document.createElement("div")
  sheet.id = "ann-mobile-sheet"
  sheet.className = "ann-mobile-sheet"

  const quote = ann.quote || ""
  const note = ann.note || ""
  const username = ann.user?.username || "匿名"
  const avatarUrl = ann.user?.avatar_url || ""

  const escHtml = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c] || c,
    )

  sheet.innerHTML = `
    <div class="ann-mobile-sheet-backdrop"></div>
    <div class="ann-mobile-sheet-content">
      <div class="ann-mobile-sheet-handle"></div>
      <div class="ann-mobile-sheet-quote">${escHtml(quote)}</div>
      ${note ? `<div class="ann-mobile-sheet-note">${escHtml(note)}</div>` : ""}
      <div class="ann-mobile-sheet-meta">
        ${avatarUrl ? `<img class="ann-mobile-sheet-avatar" src="${escHtml(avatarUrl)}" alt="" />` : ""}
        <span>${escHtml(username)}</span>
      </div>
      <button class="ann-mobile-sheet-close" type="button">关闭</button>
    </div>
  `

  document.body.appendChild(sheet)

  // 关闭
  const closeBtn = sheet.querySelector(".ann-mobile-sheet-close")
  const backdrop = sheet.querySelector(".ann-mobile-sheet-backdrop")
  const close = () => sheet.remove()
  closeBtn?.addEventListener("click", close)
  backdrop?.addEventListener("click", close)
}

/** 主初始化 */
async function init() {
  const runToken = ++initRunToken

  // 先清理上一次（SPA 导航）
  runCleanup()
  clearAllHighlights()
  clearSidebar()

  if (!shouldEnable()) return

  const slug = getCurrentSlug()
  const root = getArticleRoot()
  if (!root) return

  // 初始化侧边栏
  initSidebar()
  renderSidebar([])
  addLocalCleanup(initRightSidebarWheelProxy())

  // 等待 Supabase
  const client = await waitForSupabase()
  if (isStaleRun(runToken)) return
  if (!client) {
    console.log("[annotation] Supabase 未就绪，批注功能不可用")
    return
  }

  const { data: listener } = client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => void init(), 0)
  })
  addLocalCleanup(() => listener?.subscription?.unsubscribe())
  window.addCleanup(() => {
    runCleanup()
    clearAllHighlights()
    clearSidebar()
  })
  const status = await readMembership(client)
  if (isStaleRun(runToken)) return
  if (status !== "approved") {
    const panel = document.getElementById("annotation-sidebar-list")
    if (panel) panel.textContent = membershipMessage[status]
    setCurrentUserId(null)
    return
  }

  // 加载已有批注
  let annotations: Annotation[] = []
  try {
    annotations = await fetchAnnotations(slug)
    if (isStaleRun(runToken)) return
  } catch (err) {
    if (isStaleRun(runToken)) return
    console.error("[annotation] 加载批注失败:", err)
  }

  // 当前登录用户（用于首屏渲染编辑/删除权限）
  const userId = await getCurrentUserId()
  if (isStaleRun(runToken)) return
  setCurrentUserId(userId)

  // 应用高亮
  if (annotations.length > 0) {
    applyAllHighlights(annotations, root)
  }

  // 渲染侧边栏
  renderSidebar(annotations)

  // 只有登录用户才能创建新批注
  if (userId) {
    const cleanupSelection = initSelection(slug, (newAnn: Annotation) => {
      annotations.push(newAnn)
    })
    addLocalCleanup(cleanupSelection)
  }

  // Realtime 订阅：其他用户增删改批注时自动刷新
  const realtimeSub = initAnnotationRealtime(client, slug, async () => {
    if (isStaleRun(runToken)) return
    // 重新拉取全部批注
    const freshAnnotations = await fetchAnnotations(slug)
    if (isStaleRun(runToken)) return
    annotations = freshAnnotations

    // 重新渲染高亮和侧边栏
    clearAllHighlights()
    if (freshAnnotations.length > 0) {
      applyAllHighlights(freshAnnotations, root)
    }
    renderSidebar(freshAnnotations)
  })
  if (realtimeSub) {
    addLocalCleanup(() => realtimeSub.unsubscribe())
  }

  // 监听高亮点击 → 桌面：闪烁侧边栏卡片；移动端：底部弹窗显示详情
  const handleHighlightClick = (e: Event) => {
    const target = e.target as HTMLElement
    const mark = target.closest("mark.ann-highlight") as HTMLElement
    if (!mark) return
    const annId = mark.dataset.annId
    if (!annId) return

    const isMobile = window.innerWidth <= 800

    if (isMobile) {
      // 移动端：显示底部弹窗
      const ann = annotations.find((a) => a.id === annId)
      if (ann) showMobileAnnotationSheet(ann)
    } else {
      // 桌面端：侧边栏卡片闪烁
      setActiveCard(annId)
      const card = document.querySelector(`[data-ann-card-id="${annId}"]`) as HTMLElement
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" })
        card.classList.add("ann-card-flash")
        setTimeout(() => card.classList.remove("ann-card-flash"), 1500)
      }
    }
  }

  root.addEventListener("click", handleHighlightClick)
  addLocalCleanup(() => root.removeEventListener("click", handleHighlightClick))

  // 滚动追踪：检测视口中最接近中心的高亮，设为活跃
  let scrollRaf: number | null = null
  const handleScroll = () => {
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null
      const marks = root.querySelectorAll("mark.ann-highlight[data-ann-id]")
      if (marks.length === 0) {
        setActiveCard(null)
        return
      }

      const viewCenter = window.innerHeight / 2
      let closestId: string | null = null
      let closestDist = Infinity

      // 用 Set 去重（同一注释可能有多个 mark 段）
      const seen = new Set<string>()
      marks.forEach((m) => {
        const el = m as HTMLElement
        const annId = el.dataset.annId
        if (!annId || seen.has(annId)) return
        seen.add(annId)

        const rect = el.getBoundingClientRect()
        // 只考虑在视口内的高亮
        if (rect.bottom < 0 || rect.top > window.innerHeight) return

        const dist = Math.abs(rect.top + rect.height / 2 - viewCenter)
        if (dist < closestDist) {
          closestDist = dist
          closestId = annId
        }
      })

      setActiveCard(closestId)
    })
  }

  window.addEventListener("scroll", handleScroll, { passive: true })
  addLocalCleanup(() => {
    window.removeEventListener("scroll", handleScroll)
    if (scrollRaf) cancelAnimationFrame(scrollRaf)
  })

  // 窗口 resize 时重新对齐卡片
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  const handleResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      realignCards()
    }, 200)
  }
  window.addEventListener("resize", handleResize)
  addLocalCleanup(() => {
    window.removeEventListener("resize", handleResize)
    if (resizeTimer) clearTimeout(resizeTimer)
  })

  // 注册到全局清理
  if (window.addCleanup) {
    window.addCleanup(() => {
      runCleanup()
      clearAllHighlights()
      clearSidebar()
    })
  }
}

// SPA 兼容：监听 nav 事件
document.addEventListener("nav", () => init())
init()
