/**
 * 侧边栏注释面板
 *
 * 在右侧边栏中渲染注释卡片列表，
 * 每张卡片与对应的高亮在垂直位置上对齐。
 */

import type { Annotation } from "./types"
import { scrollToHighlight, removeHighlight } from "./highlight"
import {
  deleteAnnotation as deleteAnnotationApi,
  updateAnnotation as updateAnnotationApi,
} from "./data"

/** 侧边栏容器 */
let sidebarContainer: HTMLElement | null = null
/** 批注面板容器 */
let annotationContainer: HTMLElement | null = null
/** 批注面板折叠按钮 */
let toggleButton: HTMLButtonElement | null = null
/** 当前注释列表 */
let annotations: Annotation[] = []
/** 当前登录用户 ID（用于判断编辑/删除权限） */
let currentUserId: string | null = null
/** 面板折叠状态 */
let collapsed = false

function applyCollapsedState(): void {
  if (annotationContainer) {
    annotationContainer.classList.toggle("collapsed", collapsed)
  }
  if (toggleButton) {
    toggleButton.classList.toggle("collapsed", collapsed)
    toggleButton.setAttribute("aria-expanded", String(!collapsed))
  }
}

/**
 * 初始化侧边栏
 */
export function initSidebar(): void {
  annotationContainer = document.getElementById("annotation-container")
  sidebarContainer = document.getElementById("annotation-sidebar-list")
  toggleButton = document.getElementById("annotation-toggle") as HTMLButtonElement | null

  if (toggleButton) {
    toggleButton.onclick = () => {
      collapsed = !collapsed
      applyCollapsedState()
    }
  }

  applyCollapsedState()
}

/**
 * 设置当前用户 ID（控制编辑/删除按钮可见性）
 */
export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId
}

/**
 * 渲染所有注释卡片
 */
export function renderSidebar(anns: Annotation[]): void {
  annotations = [...anns]

  if (!sidebarContainer) {
    sidebarContainer = document.getElementById("annotation-sidebar-list")
  }
  if (!sidebarContainer) return

  sidebarContainer.innerHTML = ""

  if (annotations.length === 0) {
    sidebarContainer.innerHTML = `
      <div class="ann-empty">
        <p>暂无批注</p>
        <p class="ann-empty-hint">选中文本即可添加批注</p>
      </div>
    `
    return
  }

  for (const ann of annotations) {
    const card = createCard(ann)
    sidebarContainer.appendChild(card)
  }

  // 延迟对齐（等待高亮渲染完成后获取位置）
  requestAnimationFrame(() => {
    alignCards()
  })
}

/**
 * 添加单个注释卡片（增量更新）
 */
export function addAnnotationCard(annotation: Annotation): void {
  annotations.push(annotation)

  if (!sidebarContainer) {
    sidebarContainer = document.getElementById("annotation-sidebar-list")
  }
  if (!sidebarContainer) return

  // 如果有空状态提示，先清除
  const empty = sidebarContainer.querySelector(".ann-empty")
  if (empty) empty.remove()

  const card = createCard(annotation)
  sidebarContainer.appendChild(card)

  requestAnimationFrame(() => {
    alignCards()
  })
}

/**
 * 移除指定注释卡片
 */
function removeCard(id: string): void {
  const card = sidebarContainer?.querySelector(`[data-ann-card-id="${id}"]`)
  if (card) card.remove()
  annotations = annotations.filter((a) => a.id !== id)

  if (annotations.length === 0 && sidebarContainer) {
    sidebarContainer.innerHTML = `
      <div class="ann-empty">
        <p>暂无批注</p>
        <p class="ann-empty-hint">选中文本即可添加批注</p>
      </div>
    `
  }
}

/**
 * 创建一张注释卡片
 */
function createCard(ann: Annotation): HTMLElement {
  const card = document.createElement("div")
  card.className = "ann-card"
  card.dataset.annCardId = ann.id

  const quote = ann.quote || ""
  const truncatedQuote = quote.length > 60 ? quote.substring(0, 57) + "..." : quote
  const note = ann.note || ""
  const username = ann.user?.username || "匿名"
  const avatarUrl = ann.user?.avatar_url || ""
  const timeStr = formatTime(ann.created_at)

  // 是否是当前用户的注释（可编辑/删除）
  const isOwner = currentUserId != null && ann.user_id === currentUserId

  card.innerHTML = `
    <div class="ann-card-quote">${escapeHtml(truncatedQuote)}</div>
    <div class="ann-card-note-display">${note ? escapeHtml(note) : '<span class="ann-card-note-empty">无批注说明</span>'}</div>
    <div class="ann-card-note-edit" style="display:none;">
      <textarea class="ann-card-edit-input" maxlength="5000" rows="3">${escapeHtml(note)}</textarea>
      <div class="ann-card-edit-actions">
        <button class="ann-card-edit-cancel" type="button">取消</button>
        <button class="ann-card-edit-save" type="button">保存</button>
      </div>
    </div>
    <div class="ann-card-meta">
      ${avatarUrl ? `<img class="ann-card-avatar" src="${escapeHtml(avatarUrl)}" alt="" />` : ""}
      <span class="ann-card-author">${escapeHtml(username)}</span>
      <span class="ann-card-time">${timeStr}</span>
      ${
        isOwner
          ? `
        <button class="ann-card-edit" title="编辑批注" data-ann-edit="${ann.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="ann-card-delete" title="删除批注" data-ann-delete="${ann.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      `
          : ""
      }
    </div>
  `

  if (!document.querySelector(`mark[data-ann-id="${CSS.escape(ann.id)}"]`)) {
    const status = document.createElement("p")
    status.className = "ann-anchor-status"
    status.textContent = "原文已变化或位置不明确，此批注需要重新定位。"
    status.setAttribute("role", "status")
    card.prepend(status)
  }

  // 点击卡片 → 滚动到高亮
  card.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    // 如果点击的是按钮/编辑区域，不触发滚动
    if (
      target.closest("[data-ann-delete]") ||
      target.closest("[data-ann-edit]") ||
      target.closest(".ann-card-note-edit")
    )
      return
    scrollToHighlight(ann.id)
  })

  // 编辑按钮
  const editBtn = card.querySelector("[data-ann-edit]")
  editBtn?.addEventListener("click", (e) => {
    e.stopPropagation()
    enterEditMode(card, ann)
  })

  // 删除按钮
  const deleteBtn = card.querySelector("[data-ann-delete]")
  deleteBtn?.addEventListener("click", async (e) => {
    e.stopPropagation()
    if (!confirm("确定删除此批注？")) return

    const success = await deleteAnnotationApi(ann.id)
    if (success) {
      removeHighlight(ann.id)
      removeCard(ann.id)
    }
  })

  return card
}

/**
 * 进入编辑模式
 */
function enterEditMode(card: HTMLElement, ann: Annotation): void {
  const noteDisplay = card.querySelector(".ann-card-note-display") as HTMLElement
  const noteEdit = card.querySelector(".ann-card-note-edit") as HTMLElement
  if (!noteDisplay || !noteEdit) return

  card.classList.add("ann-card-editing")
  noteDisplay.style.display = "none"
  noteEdit.style.display = "block"

  const textarea = noteEdit.querySelector(".ann-card-edit-input") as HTMLTextAreaElement
  if (textarea) {
    textarea.value = ann.note || ""
    textarea.focus()
    // 光标移到末尾
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }

  // 取消
  const cancelBtn = noteEdit.querySelector(".ann-card-edit-cancel")
  const handleCancel = () => {
    exitEditMode(card)
    cancelBtn?.removeEventListener("click", handleCancel)
  }
  cancelBtn?.addEventListener("click", handleCancel)

  // 保存
  const saveBtn = noteEdit.querySelector(".ann-card-edit-save")
  const handleSave = async () => {
    const newNote = textarea?.value?.trim() || ""
    const saveBtnEl = saveBtn as HTMLButtonElement
    saveBtnEl.disabled = true
    saveBtnEl.textContent = "保存中..."

    const success = await updateAnnotationApi(ann.id, newNote)
    if (success) {
      ann.note = newNote
      // 更新显示
      noteDisplay.innerHTML = newNote
        ? escapeHtml(newNote)
        : '<span class="ann-card-note-empty">无批注说明</span>'
      exitEditMode(card)
    } else {
      saveBtnEl.disabled = false
      saveBtnEl.textContent = "保存"
    }

    saveBtn?.removeEventListener("click", handleSave)
  }
  saveBtn?.addEventListener("click", handleSave)

  // Ctrl+Enter / Cmd+Enter 快捷保存
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSave()
      textarea?.removeEventListener("keydown", handleKeydown as EventListener)
    }
    if (e.key === "Escape") {
      e.preventDefault()
      handleCancel()
      textarea?.removeEventListener("keydown", handleKeydown as EventListener)
    }
  }
  textarea?.addEventListener("keydown", handleKeydown as EventListener)
}

/**
 * 退出编辑模式
 */
function exitEditMode(card: HTMLElement): void {
  card.classList.remove("ann-card-editing")
  const noteDisplay = card.querySelector(".ann-card-note-display") as HTMLElement
  const noteEdit = card.querySelector(".ann-card-note-edit") as HTMLElement
  if (noteDisplay) noteDisplay.style.display = ""
  if (noteEdit) noteEdit.style.display = "none"
}

/**
 * 对齐卡片位置与高亮的垂直位置
 * 仅在桌面端（>= 1200px）生效
 */
function alignCards(): void {
  if (!sidebarContainer) return

  const cards = sidebarContainer.querySelectorAll(".ann-card") as NodeListOf<HTMLElement>
  // 保持紧凑列表：不做高亮位置对齐，避免出现大段留白
  cards.forEach((card) => {
    card.style.marginTop = ""
  })
}

/**
 * 清空侧边栏
 */
export function clearSidebar(): void {
  if (sidebarContainer) {
    sidebarContainer.innerHTML = ""
  }
  annotations = []
}

/**
 * 设置某个卡片为活跃状态（高亮对应卡片，去除其他卡片的活跃状态）
 */
export function setActiveCard(annId: string | null): void {
  if (!sidebarContainer) return
  const cards = sidebarContainer.querySelectorAll(".ann-card")
  cards.forEach((card) => {
    const el = card as HTMLElement
    if (annId && el.dataset.annCardId === annId) {
      el.classList.add("ann-card-active")
    } else {
      el.classList.remove("ann-card-active")
    }
  })
}

/**
 * 重新对齐卡片位置（供外部在 resize/scroll 时调用）
 */
export function realignCards(): void {
  alignCards()
}

// ============================================
// 工具函数
// ============================================

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  }
  return str.replace(/[&<>"']/g, (ch) => map[ch] || ch)
}

function formatTime(isoStr: string): string {
  try {
    const date = new Date(isoStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    // 小于 1 分钟
    if (diff < 60 * 1000) return "刚刚"
    // 小于 1 小时
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
    // 小于 24 小时
    if (diff < 86400 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
    // 小于 7 天
    if (diff < 7 * 86400 * 1000) return `${Math.floor(diff / 86400000)} 天前`

    // 超过 7 天显示日期
    return `${date.getMonth() + 1}/${date.getDate()}`
  } catch {
    return ""
  }
}
