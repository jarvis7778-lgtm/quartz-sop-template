/**
 * Supabase 数据层 - 预约 CRUD 操作
 * 修复了：
 *   1. 日期范围查询 bug (Phase 1.2)
 *   2. 错误返回值检查 (Phase 1.3)
 */

import type { Reservation, SupabaseClient, CalendarView } from "./types"
import { getWeekStart } from "./utils"

/** 根据当前视图计算查询的日期范围 */
export function getDateRange(
  view: CalendarView,
  currentDate: Date,
): { startDate: Date; endDate: Date } {
  let startDate: Date
  let endDate: Date

  if (view === "week") {
    startDate = getWeekStart(currentDate)
    endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 7)
  } else if (view === "month") {
    // 月视图需要包含前后溢出的日期（最多显示 6 周）
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const dayOfWeek = monthStart.getDay()
    const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    startDate = new Date(monthStart)
    startDate.setDate(startDate.getDate() - offset)
    endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 42) // 6 周
  } else {
    // day
    startDate = new Date(currentDate)
    startDate.setHours(0, 0, 0, 0)
    endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + 1)
  }

  return { startDate, endDate }
}

/**
 * 加载预约数据
 *
 * [BUG FIX] 原来的查询：
 *   .gte('start_time', startDate).lt('end_time', endDate)
 * 这会漏掉 start_time < startDate 但 end_time 在范围内的预约（跨范围预约）
 *
 * 正确的查询逻辑：只要预约和视图范围有交集就应该显示
 *   start_time < endDate AND end_time > startDate
 */
export async function loadReservations(
  client: SupabaseClient,
  view: CalendarView,
  currentDate: Date,
): Promise<Reservation[]> {
  const { startDate, endDate } = getDateRange(view, currentDate)

  const { data, error } = await client
    .from("reservations")
    .select("*, user:users(id, username, avatar_url)")
    .lt("start_time", endDate.toISOString())
    .gt("end_time", startDate.toISOString())
    .order("start_time")

  if (error) {
    console.error("加载预约失败:", error)
    throw new Error(error.message)
  }

  const reservations = (data || []) as Reservation[]

  // 兜底：若联表用户名缺失，再按 user_id 批量补查
  const missingUserIds = Array.from(
    new Set(
      reservations
        .filter((r) => !!r.user_id && !r.user?.username)
        .map((r) => r.user_id)
        .filter(Boolean),
    ),
  )

  if (missingUserIds.length > 0) {
    const { data: usersData, error: usersError } = await client
      .from("users")
      .select("id, username, avatar_url")
      .in("id", missingUserIds)

    if (!usersError && usersData) {
      type ReservationUser = { id: string; username?: string | null; avatar_url?: string | null }
      const userMap = new Map(
        (usersData as ReservationUser[]).map((user) => [user.id, user] as const),
      )
      reservations.forEach((reservation) => {
        if (!reservation.user?.username) {
          const user = userMap.get(reservation.user_id)
          if (user) {
            reservation.user = {
              id: user.id,
              username: user.username || "",
              avatar_url: user.avatar_url || undefined,
            }
          }
        }
      })
    }
  }

  return reservations
}

/** 保存预约（新建或更新） */
export async function saveReservation(
  client: SupabaseClient,
  params: {
    id?: string
    title: string
    equipment: string | null
    description: string | null
    start_time: string
    end_time: string
    color: string
    user_id: string
  },
): Promise<void> {
  if (params.id) {
    // 更新
    const { error } = await client
      .from("reservations")
      .update({
        title: params.title,
        equipment: params.equipment,
        description: params.description,
        start_time: params.start_time,
        end_time: params.end_time,
        color: params.color,
      })
      .eq("id", params.id)

    if (error) {
      console.error("更新预约失败:", error)
      throw new Error(
        error.code === "23P01"
          ? "该资源在此时段已被预约，请刷新日历并选择其他时间。"
          : error.message,
      )
    }
  } else {
    // 新建
    const { error } = await client.from("reservations").insert({
      title: params.title,
      equipment: params.equipment,
      description: params.description,
      start_time: params.start_time,
      end_time: params.end_time,
      color: params.color,
      user_id: params.user_id,
    })

    if (error) {
      console.error("创建预约失败:", error)
      throw new Error(
        error.code === "23P01"
          ? "该资源在此时段已被预约，请刷新日历并选择其他时间。"
          : error.message,
      )
    }
  }
}

/** 删除预约 */
export async function deleteReservation(
  client: SupabaseClient,
  reservationId: string,
): Promise<void> {
  const { error } = await client.from("reservations").delete().eq("id", reservationId)

  if (error) {
    console.error("删除预约失败:", error)
    throw new Error(error.message)
  }
}
