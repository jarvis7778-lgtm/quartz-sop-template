/**
 * 预约系统类型定义
 */

export interface User {
  id: string
  username: string
  avatar_url?: string
  role?: "admin" | "member"
}

export interface Reservation {
  id: string
  title: string
  description?: string
  equipment?: string
  user_id: string
  start_time: string
  end_time: string
  color: string
  created_at: string
  user?: User
}

/** 带布局信息的预约（用于渲染并行预约） */
export interface LayoutReservation extends Reservation {
  column: number
  totalColumns: number
}

export type CalendarView = "month" | "week" | "day"

export interface CalendarState {
  currentView: CalendarView
  currentDate: Date
  reservations: Reservation[]
  currentUser: any | null
  currentUserDbRecord: User | null
  editingReservation: Reservation | null
  workStart: number
  workEnd: number
}

/** Supabase client 接口（运行时从 window 获取） */
export interface SupabaseClient {
  rpc?: (name: string) => PromiseLike<{ data: unknown; error: unknown }>
  from: (table: string) => any
  auth: {
    getUser: () => Promise<{ data: { user: any } }>
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      data: { subscription: { unsubscribe: () => void } }
    }
  }
  channel: (name: string) => any
}

/** DOM 元素引用 */
export interface CalendarElements {
  container: HTMLElement
  calContainer: HTMLElement
  modal: HTMLElement
  modalTitle: HTMLElement
  form: HTMLFormElement
  loginPrompt: HTMLElement
}
