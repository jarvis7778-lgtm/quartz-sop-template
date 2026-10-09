import { createClient } from "@supabase/supabase-js"
import { readMembership, membershipMessage } from "./membership"

Object.assign(window, {
  readCollaborationMembership: readMembership,
  collaborationMembershipMessage: membershipMessage,
})

declare global {
  interface Window {
    __SUPABASE_URL__?: string
    __SUPABASE_ANON_KEY__?: string
    supabaseClient?: ReturnType<typeof createClient>
    supabaseClientReady?: Promise<ReturnType<typeof createClient> | null>
  }
}

function hasSupabaseConfig(): boolean {
  const url = window.__SUPABASE_URL__
  const key = window.__SUPABASE_ANON_KEY__
  return Boolean(url && key && url !== "__SUPABASE_URL__" && key !== "__SUPABASE_ANON_KEY__")
}

export function ensureSupabaseClient() {
  if (window.supabaseClient) return Promise.resolve(window.supabaseClient)
  if (!hasSupabaseConfig()) return Promise.resolve(null)

  if (!window.supabaseClientReady) {
    window.supabaseClientReady = Promise.resolve().then(() => {
      if (!window.supabaseClient) {
        window.supabaseClient = createClient(
          window.__SUPABASE_URL__ as string,
          window.__SUPABASE_ANON_KEY__ as string,
        )
      }
      return window.supabaseClient
    })
  }

  return window.supabaseClientReady
}

void ensureSupabaseClient()
