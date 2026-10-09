import { test, expect } from "@playwright/test"

for (const [status, message] of [
  ["pending", "等待管理员批准"],
  ["revoked", "协作权限已撤销"],
  ["unavailable", "无法验证协作权限"],
]) {
  test(`${status} member cannot edit collaboration`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript((status) => {
      const w = window as any
      const user = { id: "pending", user_metadata: { user_name: "Pending tester" } }
      const query: any = {
        select: () => query,
        eq: () => query,
        in: () => query,
        is: () => query,
        lt: () => query,
        gt: () => query,
        order: async () => ({ data: [], error: null }),
        single: async () => ({ data: null, error: null }),
      }
      const client = {
        rpc: async () => ({ data: status, error: status === "unavailable" ? {} : null }),
        from: () => query,
        auth: {
          getSession: async () => ({ data: { session: { user } } }),
          getUser: async () => ({ data: { user } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        channel: () => ({
          on() {
            return this
          },
          subscribe() {
            return this
          },
          unsubscribe() {},
        }),
      }
      w.supabaseClient = client
      w.supabaseClientReady = Promise.resolve(client)
    }, status)
    await page.goto("/sop/example-onboarding")
    await expect(page.locator("#auth-loading")).toContainText(message)
    await expect(page.locator("#comments-login-prompt")).toContainText(message)
    await expect(page.locator("#comments-input-area")).toBeHidden()
    await expect(page.locator("#annotation-sidebar-list")).toContainText(message)
    await page.goto("/calendar")
    await expect(page.locator("#calendar-login-prompt")).toContainText(message)
    expect(errors).toEqual([])
  })
}
