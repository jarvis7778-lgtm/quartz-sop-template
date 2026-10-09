/**
 * 注释系统类型定义
 */

/** 锚点数据 —— 用于精确定位文本在 DOM 中的位置 */
export interface AnchorData {
  /** 起始节点的 CSS 选择器路径（相对于 article 根元素） */
  startContainer: string
  /** 起始偏移量（文本节点内的字符偏移） */
  startOffset: number
  /** 结束节点的 CSS 选择器路径 */
  endContainer: string
  /** 结束偏移量 */
  endOffset: number
  /** 选中的文本内容（用于验证/模糊匹配回退） */
  text: string
}

/** 用户信息（联表查询结果） */
export interface AnnotationUser {
  id: string
  username: string
  avatar_url?: string
}

/** 注释数据 */
export interface Annotation {
  id: string
  page_slug: string
  anchor: AnchorData | null
  quote: string | null
  note: string | null
  user_id: string
  created_at: string
  updated_at?: string
  /** 联表的用户信息 */
  user?: AnnotationUser
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

// Window 扩展声明在 globals.d.ts 中
// supabaseClient 在运行时由 Auth.tsx 创建
// addCleanup 在运行时由 spa.inline.ts 创建
