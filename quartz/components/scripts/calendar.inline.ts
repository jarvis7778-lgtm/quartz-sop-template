/**
 * 预约日历 - 客户端入口
 *
 * 这个文件会被 Quartz 的 esbuild 打包成一个 browser bundle，
 * 作为 ReservationCalendar 组件的 afterDOMLoaded 脚本。
 */

import type { CalendarState, CalendarView, SupabaseClient } from "./calendar/types"
import { CleanupManager } from "./calendar/utils"
import { loadReservations } from "./calendar/data"
import { renderWeekView, renderMonthView, renderDayView, getRangeText } from "./calendar/renderer"
import { openModal, closeModal, handleSave, handleDelete } from "./calendar/modal"
import { initDragSystem } from "./calendar/drag"
import { initRealtime } from "./calendar/realtime"
import { readMembership, membershipMessage } from "./membership"

async function init() {
  const container = document.getElementById("reservation-calendar")
  if (!container) return

  // 防止重复初始化
  if (container.dataset.inited === "1") return
  container.dataset.inited = "1"

  const calContainer = document.getElementById("calendar-container")
  const modal = document.getElementById("reservation-modal")
  const modalTitle = document.getElementById("modal-title")
  const form = document.getElementById("reservation-form") as HTMLFormElement
  const loginPrompt = document.getElementById("calendar-login-prompt")

  if (!calContainer || !modal || !modalTitle || !form || !loginPrompt) {
    console.error("ReservationCalendar 初始化失败：缺少必要 DOM 节点")
    return
  }

  // 读取配置
  const defaultView = (container.dataset.defaultView || "week") as CalendarView
  const isMobile = window.matchMedia("(max-width: 768px)").matches
  const initialView: CalendarView = isMobile && defaultView === "week" ? "day" : defaultView
  const workStart = parseInt(container.dataset.workStart || "8") || 8
  const workEnd = parseInt(container.dataset.workEnd || "24") || 24

  // 状态
  const state: CalendarState = {
    currentView: initialView,
    currentDate: new Date(),
    reservations: [],
    currentUser: null,
    currentUserDbRecord: null,
    editingReservation: null,
    workStart,
    workEnd,
  }

  // 清理管理器
  const cleanup = new CleanupManager()
  cleanup.add(() => {
    cleanup.stopped = true
    delete container.dataset.inited
  })

  // 客户端由全局 prescript 本地打包并初始化；无需轮询 Auth 组件。
  async function waitForSupabase(): Promise<SupabaseClient | null> {
    const client = await (window as any).supabaseClientReady
    return cleanup.stopped ? null : client
  }

  calContainer.innerHTML = '<div class="calendar-loading">加载中...</div>'

  try {
    const client = await waitForSupabase()
    if (!client) {
      calContainer.innerHTML = '<div class="calendar-loading">预约功能未配置</div>'
      return
    }

    // ================ 核心渲染函数 ================

    async function renderCurrentView(): Promise<void> {
      // 更新范围显示
      const rangeEl = document.getElementById("cal-current-range")
      if (rangeEl) {
        rangeEl.textContent = getRangeText(state.currentView, state.currentDate)
      }

      // 加载数据
      try {
        state.reservations = await loadReservations(client!, state.currentView, state.currentDate)
      } catch {
        state.reservations = []
      }

      // 渲染对应视图
      if (state.currentView === "week") {
        calContainer!.innerHTML = renderWeekView(
          state.reservations,
          state.currentDate,
          state.workStart,
          state.workEnd,
        )
      } else if (state.currentView === "month") {
        calContainer!.innerHTML = renderMonthView(state.reservations, state.currentDate)
      } else {
        calContainer!.innerHTML = renderDayView(
          state.reservations,
          state.currentDate,
          state.workStart,
          state.workEnd,
        )
      }

      // 绑定日历内部事件
      bindCalendarEvents()
    }

    // ================ 日历内部事件绑定 ================

    function bindCalendarEvents(): void {
      // 点击空白时间格创建预约
      document.querySelectorAll(".hour-slot").forEach((slot) => {
        const handler = (e: Event) => {
          if (!state.currentUser) {
            alert("请先登录")
            return
          }
          const target = e.target as HTMLElement
          const col = target.closest(".day-column") as HTMLElement
          if (!col) return
          const date = col.dataset.date!
          const hour = parseInt(target.dataset.hour || "9")
          openModal(state, modal!, modalTitle!, null, date, hour)
        }
        ;(slot as HTMLElement).addEventListener("click", handler)
        cleanup.add(() => (slot as HTMLElement).removeEventListener("click", handler))
      })

      // 点击月视图的日期格子
      document.querySelectorAll(".month-day").forEach((day) => {
        const handler = (e: Event) => {
          const target = e.target as HTMLElement
          // 点击 "+N" 切换到日视图
          if (target.classList.contains("month-event-more")) {
            const dayEl = target.closest(".month-day") as HTMLElement
            if (dayEl?.dataset.date) {
              state.currentDate = new Date(dayEl.dataset.date + "T00:00:00")
              state.currentView = "day"
              // 更新视图按钮状态
              document.querySelectorAll(".view-btn").forEach((b) => {
                b.classList.toggle("active", (b as HTMLElement).dataset.view === "day")
              })
              renderCurrentView()
            }
            return
          }
          if (target.classList.contains("month-event")) return
          if (!state.currentUser) {
            alert("请先登录")
            return
          }
          const dayEl = day as HTMLElement
          openModal(state, modal!, modalTitle!, null, dayEl.dataset.date!, 9)
        }
        ;(day as HTMLElement).addEventListener("click", handler)
        cleanup.add(() => (day as HTMLElement).removeEventListener("click", handler))
      })

      // 点击预约查看/编辑
      document.querySelectorAll(".event, .month-event").forEach((ev) => {
        const el = ev as HTMLElement
        if (el.classList.contains("month-event-more")) return // 跳过 "+N"
        const handler = (e: Event) => {
          e.stopPropagation()
          const id = el.dataset.id
          const reservation = state.reservations.find((r) => r.id === id)
          if (reservation) {
            openModal(state, modal!, modalTitle!, reservation)
          }
        }
        el.addEventListener("click", handler)
        cleanup.add(() => el.removeEventListener("click", handler))
      })

      // 初始化拖拽系统（仅日视图/周视图）
      initDragSystem(state, client!, calContainer!, modal!, modalTitle!, cleanup, renderCurrentView)
    }

    // ================ 控制按钮 ================

    const prevBtn = document.getElementById("cal-prev")
    const nextBtn = document.getElementById("cal-next")
    const todayBtn = document.getElementById("cal-today")

    if (prevBtn) {
      cleanup.listen(prevBtn, "click", () => {
        if (state.currentView === "week") {
          state.currentDate.setDate(state.currentDate.getDate() - 7)
        } else if (state.currentView === "month") {
          state.currentDate.setMonth(state.currentDate.getMonth() - 1)
        } else {
          state.currentDate.setDate(state.currentDate.getDate() - 1)
        }
        renderCurrentView()
      })
    }

    if (nextBtn) {
      cleanup.listen(nextBtn, "click", () => {
        if (state.currentView === "week") {
          state.currentDate.setDate(state.currentDate.getDate() + 7)
        } else if (state.currentView === "month") {
          state.currentDate.setMonth(state.currentDate.getMonth() + 1)
        } else {
          state.currentDate.setDate(state.currentDate.getDate() + 1)
        }
        renderCurrentView()
      })
    }

    if (todayBtn) {
      cleanup.listen(todayBtn, "click", () => {
        state.currentDate = new Date()
        renderCurrentView()
      })
    }

    // 视图切换
    document.querySelectorAll(".view-btn").forEach((btn) => {
      const el = btn as HTMLElement
      cleanup.listen(el, "click", () => {
        document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"))
        el.classList.add("active")
        state.currentView = el.dataset.view as CalendarView
        renderCurrentView()
      })
    })

    // 首屏同步按钮状态（移动端默认可能被切到 day）
    document.querySelectorAll(".view-btn").forEach((b) => {
      b.classList.toggle("active", (b as HTMLElement).dataset.view === state.currentView)
    })

    // ================ 颜色选择 ================

    document.querySelectorAll(".color-option").forEach((opt) => {
      const el = opt as HTMLElement
      cleanup.listen(el, "click", () => {
        document.querySelectorAll(".color-option").forEach((o) => o.classList.remove("selected"))
        el.classList.add("selected")
      })
    })

    // ================ 弹窗事件 ================

    const overlay = modal.querySelector(".modal-overlay") as HTMLElement
    if (overlay) {
      cleanup.listen(overlay, "click", () => closeModal(state, modal!))
    }

    const cancelBtn = document.getElementById("modal-cancel")
    if (cancelBtn) {
      cleanup.listen(cancelBtn, "click", () => closeModal(state, modal!))
    }

    const deleteBtn = document.getElementById("modal-delete")
    if (deleteBtn) {
      cleanup.listen(deleteBtn, "click", () =>
        handleDelete(client!, state, modal!, renderCurrentView),
      )
    }

    cleanup.listen(form, "submit", (e: Event) => {
      e.preventDefault()
      handleSave(client!, state, modal!, renderCurrentView)
    })

    // ================ 登录状态 ================

    async function updateUserState(): Promise<void> {
      const {
        data: { user },
      } = await client!.auth.getUser()
      const status = user ? await readMembership(client) : null
      state.currentUser = status === "approved" ? user : null

      if (state.currentUser) {
        const { data } = await client!
          .from("users")
          .select("id, username, avatar_url, role")
          .eq("id", user.id)
          .single()
        state.currentUserDbRecord = data
        loginPrompt!.style.display = "none"
      } else {
        state.currentUserDbRecord = null
        loginPrompt!.textContent = status ? membershipMessage[status] : "请先登录并获得管理员批准"
        loginPrompt!.style.display = "block"
      }
    }

    const { data: authListener } = client.auth.onAuthStateChange(() => {
      setTimeout(async () => {
        if (!container.isConnected) return
        await updateUserState()
        if (container.isConnected) await renderCurrentView()
      }, 0)
    })
    cleanup.add(() => authListener?.subscription?.unsubscribe?.())

    // ================ 初始化 ================

    await updateUserState()
    await renderCurrentView()

    // Realtime 订阅：其他用户的变更会自动刷新视图
    initRealtime(client, cleanup, renderCurrentView)
  } catch (err) {
    console.error("ReservationCalendar 初始化失败:", err)
    calContainer.innerHTML =
      '<div class="calendar-loading">预约加载失败，请刷新重试（打开控制台查看错误）</div>'
  }
}

// SPA 兼容：监听 nav 事件在每次页面切换后重新初始化
document.addEventListener("nav", () => init())
init()
