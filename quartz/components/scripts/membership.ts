export type MembershipStatus = "pending" | "approved" | "revoked" | "unavailable"

export async function readMembership(
  client:
    | { rpc?: (name: string) => PromiseLike<{ data: unknown; error: unknown }> }
    | null
    | undefined,
): Promise<MembershipStatus> {
  try {
    const result = await client?.rpc?.("current_collaboration_membership_status")
    if (result?.error || !["pending", "approved", "revoked"].includes(String(result?.data)))
      return "unavailable"
    return result!.data as MembershipStatus
  } catch {
    return "unavailable"
  }
}

export const membershipMessage = {
  pending: "已登录，等待管理员批准；批准后请刷新页面。",
  approved: "已获准参与协作",
  revoked: "协作权限已撤销，请联系管理员。",
  unavailable: "无法验证协作权限，请联系管理员检查数据库迁移或稍后刷新。",
} satisfies Record<MembershipStatus, string>
