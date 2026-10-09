import test from "node:test"
import assert from "node:assert/strict"
import { readMembership } from "./membership"

for (const status of ["pending", "approved", "revoked"] as const) {
  test(`membership status ${status} comes from own-status RPC`, async () => {
    const client = {
      rpc: async (name: string) => {
        assert.equal(name, "current_collaboration_membership_status")
        return { data: status, error: null }
      },
    }
    assert.equal(await readMembership(client), status)
  })
}
test("missing migration, bad status and transport failure fail closed", async () => {
  for (const client of [
    undefined,
    {},
    { rpc: async () => ({ data: "approved", error: {} }) },
    { rpc: async () => ({ data: "admin", error: null }) },
    {
      rpc: async () => {
        throw Error("offline")
      },
    },
  ]) {
    assert.equal(await readMembership(client as any), "unavailable")
  }
})
