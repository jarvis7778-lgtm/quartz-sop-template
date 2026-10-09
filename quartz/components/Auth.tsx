import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

interface AuthOptions {
  loginText?: string
  logoutText?: string
}

const defaultOptions: AuthOptions = {
  loginText: "GitHub 登录",
  logoutText: "登出",
}

export default ((userOpts?: AuthOptions) => {
  const opts = { ...defaultOptions, ...userOpts }

  const Auth: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
    return (
      <div class={classNames(displayClass, "auth-container")} id="auth-container">
        <button id="auth-login-btn" class="auth-btn auth-login" style={{ display: "none" }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          <span>{opts.loginText}</span>
        </button>

        <div id="auth-user-info" class="auth-user-info" style={{ display: "none" }}>
          <img id="auth-avatar" class="auth-avatar" src="" alt="" />
          <span id="auth-username" class="auth-username"></span>
          <button id="auth-logout-btn" class="auth-btn auth-logout">
            {opts.logoutText}
          </button>
        </div>

        <div id="auth-loading" class="auth-loading" aria-live="polite">
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  Auth.css = `
    .auth-container { display: flex; align-items: center; gap: 0.5rem; }
    .auth-btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.8rem; border: 1px solid var(--gray); border-radius: 4px; background: var(--light); color: var(--dark); cursor: pointer; font-size: 0.85rem; transition: all 0.2s ease; }
    .auth-btn:hover { background: var(--lightgray); border-color: var(--secondary); }
    .auth-login svg { width: 16px; height: 16px; }
    .auth-user-info { display: flex; align-items: center; gap: 0.5rem; }
    .auth-avatar { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--lightgray); }
    .auth-username { font-size: 0.85rem; color: var(--dark); max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .auth-logout { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
    .auth-loading { font-size: 0.85rem; color: var(--gray); }
  `

  Auth.afterDOMLoaded = `
    let authRun = 0

    async function initAuth() {
      const run = ++authRun
      const container = document.getElementById('auth-container')
      if (!container) return

      const loginBtn = container.querySelector('#auth-login-btn')
      const userInfo = container.querySelector('#auth-user-info')
      const avatar = container.querySelector('#auth-avatar')
      const username = container.querySelector('#auth-username')
      const logoutBtn = container.querySelector('#auth-logout-btn')
      const loading = container.querySelector('#auth-loading')
      const client = await window.supabaseClientReady

      if (run !== authRun || !container.isConnected) return
      if (!client) {
        loading.textContent = '登录功能未配置'
        loginBtn.style.display = 'none'
        return
      }

      const getCurrentUser = async () => {
        const { data: { session } } = await client.auth.getSession()
        if (session?.user) return session.user
        const { data: { user } } = await client.auth.getUser()
        return user || null
      }

      let stateRun = 0
      const updateUI = async (user) => {
        const currentState = ++stateRun
        loading.style.display = 'none'
        if (user) {
          loginBtn.style.display = 'none'
          userInfo.style.display = 'flex'
          avatar.src = user.user_metadata?.avatar_url || ''
          username.textContent = user.user_metadata?.user_name || user.email || '用户'
          loading.style.display = 'block'
          loading.textContent = '正在验证协作权限...'
          const status = await window.readCollaborationMembership(client)
          if (currentState !== stateRun || run !== authRun || !container.isConnected) return
          loading.textContent = window.collaborationMembershipMessage[status]
          loading.style.display = status === 'approved' ? 'none' : 'block'
        } else {
          loginBtn.style.display = 'flex'
          userInfo.style.display = 'none'
        }
      }

      const onLogin = async () => {
        await client.auth.signInWithOAuth({
          provider: 'github',
          options: { redirectTo: window.location.href.split('#')[0] },
        })
      }
      const onLogout = async () => { await client.auth.signOut() }

      loginBtn.addEventListener('click', onLogin)
      logoutBtn.addEventListener('click', onLogout)
      const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
        setTimeout(() => {
          if (run === authRun && container.isConnected) void updateUI(session?.user || null)
        }, 0)
      })

      window.addCleanup(() => {
        authRun++
        loginBtn.removeEventListener('click', onLogin)
        logoutBtn.removeEventListener('click', onLogout)
        authListener?.subscription?.unsubscribe?.()
      })

      try {
        await updateUI(await getCurrentUser())
      } catch (error) {
        console.error('获取登录状态失败:', error)
        loading.textContent = '登录加载失败，请刷新重试'
      }
    }

    document.addEventListener('nav', initAuth)
    initAuth()
  `

  return Auth
}) satisfies QuartzComponentConstructor<AuthOptions>
