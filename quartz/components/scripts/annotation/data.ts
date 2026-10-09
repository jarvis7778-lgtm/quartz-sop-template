/**
 * Supabase 数据层 - 注释 CRUD 操作
 */

import type { Annotation, SupabaseClient } from "./types"
import { readMembership } from "../membership"

interface UserProfile {
  id: string
  username: string
  avatar_url?: string
}

interface RawAnnotationRow {
  id?: string
  page_slug?: string
  page_path?: string
  anchor?: any
  quote?: string | null
  note?: string | null
  user_id?: string
  author_id?: string
  text_selection?: string | null
  content?: string | null
  paragraph_id?: string | null
  created_at?: string
  updated_at?: string
}

/** 获取 Supabase client */
function getClient(): SupabaseClient | null {
  return (window as any).supabaseClient || null
}

function normalizePageSlug(input: string): string {
  let slug = input.replace(/^\/+|\/+$/g, "")
  slug = slug.replace(/\.html$/, "")
  return slug || "index"
}

function toLegacyPagePath(pageSlug: string): string {
  const slug = normalizePageSlug(pageSlug)
  return slug === "index" ? "/" : `/${slug}`
}

function fromLegacyPagePath(path: string): string {
  return normalizePageSlug(path)
}

function parseLegacyAnchor(paragraphId: string | null | undefined): any | null {
  if (!paragraphId) return null
  const text = paragraphId.trim()
  if (!text.startsWith("{") || !text.endsWith("}")) return null
  try {
    const parsed = JSON.parse(text)
    if (
      parsed &&
      typeof parsed.startContainer === "string" &&
      typeof parsed.endContainer === "string" &&
      typeof parsed.startOffset === "number" &&
      typeof parsed.endOffset === "number"
    ) {
      return parsed
    }
  } catch {
    // ignore legacy parse errors
  }
  return null
}

function normalizeAnnotationRow(row: RawAnnotationRow): Annotation | null {
  const id = row.id
  if (!id) return null

  const userId = row.user_id || row.author_id
  if (!userId) return null

  const pageSlugRaw = row.page_slug ?? row.page_path ?? "index"
  const pageSlug = row.page_slug ? normalizePageSlug(pageSlugRaw) : fromLegacyPagePath(pageSlugRaw)

  const anchor = row.anchor ?? parseLegacyAnchor(row.paragraph_id)
  const quote = row.quote ?? row.text_selection ?? null
  const note = row.note ?? row.content ?? null

  return {
    id,
    page_slug: pageSlug,
    anchor,
    quote,
    note,
    user_id: userId,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at,
  }
}

async function loadUsersMap(userIds: string[]): Promise<Map<string, UserProfile>> {
  const client = getClient()
  const userMap = new Map<string, UserProfile>()
  if (!client || userIds.length === 0) return userMap

  const { data, error } = await client
    .from("users")
    .select("id, username, avatar_url")
    .in("id", userIds)
  if (error) return userMap

  const rows = (data || []) as UserProfile[]
  for (const row of rows) {
    if (row?.id) userMap.set(row.id, row)
  }
  return userMap
}

async function attachUsers(annotations: Annotation[]): Promise<Annotation[]> {
  if (annotations.length === 0) return annotations
  const userIds = Array.from(new Set(annotations.map((a) => a.user_id).filter(Boolean)))
  const userMap = await loadUsersMap(userIds)
  return annotations.map((ann) => ({ ...ann, user: userMap.get(ann.user_id) }))
}

/** 获取当前登录用户 ID */
export async function getCurrentUserId(): Promise<string | null> {
  const client = getClient()
  if (!client) return null
  try {
    const {
      data: { user },
    } = await client.auth.getUser()
    return user && (await readMembership(client)) === "approved" ? user.id : null
  } catch {
    return null
  }
}

/**
 * 加载指定页面的所有注释
 */
export async function fetchAnnotations(pageSlug: string): Promise<Annotation[]> {
  const client = getClient()
  if (!client) return []

  const normalizedSlug = normalizePageSlug(pageSlug)

  // 优先新 schema（page_slug）
  const { data: newData, error: newError } = await client
    .from("annotations")
    .select("*")
    .eq("page_slug", normalizedSlug)
    .order("created_at", { ascending: true })

  if (!newError) {
    const anns = ((newData || []) as RawAnnotationRow[])
      .map(normalizeAnnotationRow)
      .filter(Boolean) as Annotation[]
    return attachUsers(anns)
  }

  // 回退 legacy schema（page_path）
  const legacyPath = toLegacyPagePath(normalizedSlug)
  const { data: legacyData, error: legacyError } = await client
    .from("annotations")
    .select("*")
    .eq("page_path", legacyPath)
    .order("created_at", { ascending: true })

  if (legacyError) {
    console.error("[annotation] 加载注释失败:", legacyError)
    return []
  }

  let rows = (legacyData || []) as RawAnnotationRow[]
  // 某些历史数据可能未带前导 `/`，做一次兜底查询
  if (rows.length === 0 && normalizedSlug !== "index") {
    const { data: altLegacyData, error: altLegacyError } = await client
      .from("annotations")
      .select("*")
      .eq("page_path", normalizedSlug)
      .order("created_at", { ascending: true })
    if (!altLegacyError) {
      rows = (altLegacyData || []) as RawAnnotationRow[]
    }
  }

  const anns = rows.map(normalizeAnnotationRow).filter(Boolean) as Annotation[]
  return attachUsers(anns)
}

/**
 * 创建新注释
 */
export async function createAnnotation(params: {
  pageSlug: string
  anchor: any
  quote: string
  note: string
}): Promise<Annotation | null> {
  const client = getClient()
  if (!client) return null

  const userId = await getCurrentUserId()
  if (!userId) {
    console.warn("[annotation] 未登录，无法创建注释")
    return null
  }

  const normalizedSlug = normalizePageSlug(params.pageSlug)

  // 优先新 schema
  const { data: newData, error: newError } = await client
    .from("annotations")
    .insert({
      page_slug: normalizedSlug,
      anchor: params.anchor,
      quote: params.quote,
      note: params.note,
      user_id: userId,
    })
    .select("*")
    .single()

  let normalized = !newError ? normalizeAnnotationRow((newData || {}) as RawAnnotationRow) : null

  // 回退 legacy schema
  if (!normalized) {
    const { data: legacyData, error: legacyError } = await client
      .from("annotations")
      .insert({
        page_path: toLegacyPagePath(normalizedSlug),
        paragraph_id: JSON.stringify(params.anchor || {}),
        text_selection: params.quote,
        content: params.note || params.quote || "",
        author_id: userId,
      })
      .select("*")
      .single()

    if (legacyError) {
      console.error("[annotation] 创建注释失败:", legacyError)
      return null
    }
    normalized = normalizeAnnotationRow((legacyData || {}) as RawAnnotationRow)
  }

  if (!normalized) {
    console.error("[annotation] 创建注释失败: 返回数据无法解析")
    return null
  }

  const userMap = await loadUsersMap([normalized.user_id])
  return { ...normalized, user: userMap.get(normalized.user_id) }
}

/**
 * 更新注释备注
 */
export async function updateAnnotation(id: string, note: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  const { error: newError } = await client.from("annotations").update({ note }).eq("id", id)

  if (!newError) return true

  // 回退 legacy 字段名
  const { error: legacyError } = await client
    .from("annotations")
    .update({ content: note })
    .eq("id", id)
  if (legacyError) {
    console.error("[annotation] 更新注释失败:", legacyError)
    return false
  }

  return true
}

/**
 * 删除注释
 */
export async function deleteAnnotation(id: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  const { error } = await client.from("annotations").delete().eq("id", id)

  if (error) {
    console.error("[annotation] 删除注释失败:", error)
    return false
  }

  return true
}

/**
 * 检查用户是否已登录
 */
export async function isAuthenticated(): Promise<boolean> {
  const userId = await getCurrentUserId()
  return userId !== null
}
