import test from "node:test"
import assert from "node:assert/strict"
import { saveReservation } from "./data"
import type { SupabaseClient } from "./types"

for (const id of [undefined, "booking-id"]) {
  test(`booking conflict is actionable (${id ? "update" : "insert"})`, async () => {
    const error = { code: "23P01", message: "conflicting key violates exclusion constraint" }
    const client = {
      from: () => ({
        insert: async () => ({ error }),
        update: () => ({ eq: async () => ({ error }) }),
      }),
    } as unknown as SupabaseClient
    await assert.rejects(
      saveReservation(client, {
        id,
        title: "Test",
        equipment: "Microscope",
        description: null,
        start_time: "2030-01-01T10:00Z",
        end_time: "2030-01-01T11:00Z",
        color: "blue",
        user_id: "member",
      }),
      /已被预约/,
    )
  })
}
