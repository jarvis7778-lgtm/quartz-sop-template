import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

interface SupaCommentsOptions {
  /** 评论区标题 */
  title?: string
  /** 输入框占位符 */
  placeholder?: string
}

const defaultOptions: SupaCommentsOptions = {
  title: "评论",
  placeholder: "写下你的评论...",
}

export default ((userOpts?: SupaCommentsOptions) => {
  const opts = { ...defaultOptions, ...userOpts }

  const SupaComments: QuartzComponent = ({ displayClass, fileData }: QuartzComponentProps) => {
    // 检查 frontmatter 是否禁用评论
    const disableComment = fileData.frontmatter?.comments === false
    if (disableComment) {
      return <></>
    }

    const pagePath = "/" + (fileData.slug ?? "")

    return (
      <div
        class={classNames(displayClass, "supa-comments")}
        id="supa-comments"
        data-page-path={pagePath}
      >
        <h3 class="comments-title">{opts.title}</h3>
        <p>
          其他成员的评论刷新后同步。
          <button type="button" id="refresh-comments">
            刷新评论
          </button>
        </p>

        {/* 需要登录提示 */}
        <div id="comments-login-prompt" class="comments-login-prompt" style={{ display: "none" }}>
          <p>请先登录后参与评论</p>
        </div>

        {/* 评论输入框 */}
        <div id="comments-input-area" class="comments-input-area" style={{ display: "none" }}>
          <textarea
            id="comment-input"
            class="comment-input"
            placeholder={opts.placeholder}
            maxlength={5000}
            rows={3}
          ></textarea>
          <button id="submit-comment" class="submit-comment-btn">
            发表评论
          </button>
        </div>

        {/* 评论列表 */}
        <div id="comments-list" class="comments-list">
          <div class="comments-loading">加载评论中...</div>
        </div>

        {/* 无评论提示 */}
        <div id="comments-empty" class="comments-empty" style={{ display: "none" }}>
          <p>暂无评论，来发表第一条吧！</p>
        </div>
      </div>
    )
  }

  SupaComments.css = `
    .supa-comments {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid var(--lightgray);
    }
    
    .comments-title {
      margin-bottom: 1rem;
      font-size: 1.2rem;
      color: var(--dark);
    }
    
    .comments-login-prompt {
      padding: 1rem;
      background: var(--lightgray);
      border-radius: 8px;
      text-align: center;
      color: var(--gray);
    }
    
    .comments-input-area {
      margin-bottom: 1.5rem;
    }
    
    .comment-input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--lightgray);
      border-radius: 8px;
      font-size: 0.9rem;
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }
    
    .comment-input:focus {
      outline: none;
      border-color: var(--secondary);
    }
    
    .submit-comment-btn {
      margin-top: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--secondary);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: opacity 0.2s;
    }
    
    .submit-comment-btn:hover {
      opacity: 0.9;
    }
    
    .submit-comment-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .comments-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .comment-item {
      padding: 1rem;
      background: var(--light);
      border: 1px solid var(--lightgray);
      border-radius: 8px;
    }
    
    .comment-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    
    .comment-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }
    
    .comment-author {
      font-weight: 500;
      color: var(--dark);
    }
    
    .comment-time {
      font-size: 0.8rem;
      color: var(--gray);
    }
    
    .comment-content {
      color: var(--dark);
      line-height: 1.6;
      white-space: pre-wrap;
    }
    
    .comment-actions {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;
    }
    
    .comment-action-btn {
      background: none;
      border: none;
      color: var(--gray);
      cursor: pointer;
      font-size: 0.8rem;
      padding: 0;
    }
    
    .comment-action-btn:hover {
      color: var(--secondary);
    }
    
    .comments-loading {
      text-align: center;
      color: var(--gray);
      padding: 1rem;
    }
    
    .comments-empty {
      text-align: center;
      color: var(--gray);
      padding: 2rem;
    }
    
    .comment-replies {
      margin-top: 1rem;
      margin-left: 2rem;
      padding-left: 1rem;
      border-left: 2px solid var(--lightgray);
    }
    
    .reply-input-area {
      margin-top: 0.5rem;
      display: none;
    }
    
    .reply-input-area.active {
      display: block;
    }
    
    .reply-input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--lightgray);
      border-radius: 6px;
      font-size: 0.85rem;
      resize: none;
      font-family: inherit;
    }
    
    .reply-submit-btn {
      margin-top: 0.25rem;
      padding: 0.25rem 0.5rem;
      background: var(--secondary);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    
    .delete-comment-btn {
      color: #e74c3c !important;
    }
  `

  SupaComments.afterDOMLoaded = `
    let commentsRun = 0

    async function initSupaComments() {
      const run = ++commentsRun
      const container = document.getElementById('supa-comments')
      if (!container) return
      
      const pagePath = container.dataset.pagePath
      const loginPrompt = document.getElementById('comments-login-prompt')
      const inputArea = document.getElementById('comments-input-area')
      const commentInput = document.getElementById('comment-input')
      const submitBtn = document.getElementById('submit-comment')
      const commentsList = document.getElementById('comments-list')
      const emptyPrompt = document.getElementById('comments-empty')
      
      // Supabase 客户端由全局 prescript 本地打包并初始化
      let client = null
      let currentUser = null
      let currentUserDbRecord = null

      async function getCurrentUser() {
        try {
          const { data: { session } } = await client.auth.getSession()
          if (session?.user) {
            return session.user
          }

          const { data: { user } } = await client.auth.getUser()
          return user || null
        } catch (err) {
          console.error('获取评论区登录状态失败:', err)
          return null
        }
      }
      
      try {
        client = await window.supabaseClientReady
      } catch (err) {
        console.error('初始化评论区 Supabase 失败:', err)
        commentsList.innerHTML = '<div class="comments-loading">评论初始化失败，请刷新重试</div>'
        return
      }
      if (run !== commentsRun || !container.isConnected) return
      
      if (!client) {
        commentsList.innerHTML = '<div class="comments-loading">评论功能未配置</div>'
        return
      }
      
      // 格式化时间
      function formatTime(dateStr) {
        const date = new Date(dateStr)
        const now = new Date()
        const diff = now - date
        
        if (diff < 60000) return '刚刚'
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
        if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前'
        
        return date.toLocaleDateString('zh-CN')
      }
      
      // 渲染单条评论
      function renderComment(comment, isReply = false) {
        const canDelete = currentUser && (
          comment.author_id === currentUser.id ||
          currentUserDbRecord?.role === 'admin'
        )
        
        return \`
          <div class="comment-item" data-comment-id="\${comment.id}">
            <div class="comment-header">
              <img class="comment-avatar" src="\${escapeHtml(comment.author?.avatar_url || '')}" alt="" />
              <span class="comment-author">\${escapeHtml(comment.author?.username || '匿名用户')}</span>
              <span class="comment-time">\${formatTime(comment.created_at)}</span>
            </div>
            <div class="comment-content">\${escapeHtml(comment.content)}</div>
            <div class="comment-actions">
              \${!isReply ? '<button class="comment-action-btn reply-btn">回复</button>' : ''}
              \${canDelete ? '<button class="comment-action-btn delete-comment-btn">删除</button>' : ''}
            </div>
            \${!isReply ? '<div class="reply-input-area"><textarea class="reply-input" maxlength="5000" placeholder="回复..." rows="2"></textarea><button class="reply-submit-btn">发送</button></div>' : ''}
            \${comment.replies && comment.replies.length > 0 ? 
              '<div class="comment-replies">' + comment.replies.map(r => renderComment(r, true)).join('') + '</div>' 
              : ''}
          </div>
        \`
      }
      
      // HTML 转义
      function escapeHtml(text) {
        const div = document.createElement('div')
        div.textContent = text
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      }
      
      // 加载评论
      async function loadComments() {
        if (!currentUser) {
          commentsList.innerHTML = ''
          emptyPrompt.style.display = 'none'
          return
        }
        try {
          // 获取评论 (包含作者信息)
          const { data: comments, error } = await client
            .from('comments')
            .select(\`
              *,
              author:users(id, username, avatar_url)
            \`)
            .eq('page_path', pagePath)
            .is('parent_id', null)
            .order('created_at', { ascending: false })
          
          if (error) throw error
          
          if (!comments || comments.length === 0) {
            commentsList.innerHTML = ''
            emptyPrompt.style.display = 'block'
            return
          }
          
          // 获取回复
          const commentIds = comments.map(c => c.id)
          const { data: replies } = await client
            .from('comments')
            .select(\`
              *,
              author:users(id, username, avatar_url)
            \`)
            .in('parent_id', commentIds)
            .order('created_at', { ascending: true })
          
          // 组织回复到对应评论
          const repliesMap = {}
          if (replies) {
            replies.forEach(r => {
              if (!repliesMap[r.parent_id]) repliesMap[r.parent_id] = []
              repliesMap[r.parent_id].push(r)
            })
          }
          
          comments.forEach(c => {
            c.replies = repliesMap[c.id] || []
          })
          
          emptyPrompt.style.display = 'none'
          commentsList.innerHTML = comments.map(c => renderComment(c)).join('')
          
          // 绑定事件
          bindCommentEvents()
          
        } catch (err) {
          console.error('加载评论失败:', err)
          commentsList.innerHTML = '<div class="comments-loading">加载评论失败</div>'
        }
      }
      
      // 绑定评论相关事件
      function bindCommentEvents() {
        // 回复按钮
        document.querySelectorAll('.reply-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const item = e.target.closest('.comment-item')
            const replyArea = item.querySelector('.reply-input-area')
            replyArea.classList.toggle('active')
          })
        })
        
        // 发送回复
        document.querySelectorAll('.reply-submit-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const item = e.target.closest('.comment-item')
            const parentId = item.dataset.commentId
            const input = item.querySelector('.reply-input')
            const content = input.value.trim()
            
            if (!content || !currentUser) return
            
            btn.disabled = true
            try {
              const { error } = await client.from('comments').insert({
                page_path: pagePath,
                content: content,
                author_id: currentUser.id,
                parent_id: parentId,
              })
              if (error) throw error
              input.value = ''
              await loadComments()
            } catch (err) {
              console.error('回复失败:', err)
              alert('回复失败，请重试')
            }
            btn.disabled = false
          })
        })
        
        // 删除评论
        document.querySelectorAll('.delete-comment-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            if (!confirm('确定要删除这条评论吗？')) return
            
            const item = e.target.closest('.comment-item')
            const commentId = item.dataset.commentId
            
            try {
              const { error } = await client.from('comments').delete().eq('id', commentId)
              if (error) throw error
              await loadComments()
            } catch (err) {
              console.error('删除失败:', err)
              alert('删除失败，请重试')
            }
          })
        })
      }
      
      // 更新用户状态
      async function updateUserState() {
        currentUser = await getCurrentUser()
        
        if (currentUser) {
          const status = await window.readCollaborationMembership(client)
          if (run !== commentsRun || !container.isConnected) return
          if (status !== 'approved') {
            currentUser = null
            currentUserDbRecord = null
            loginPrompt.textContent = window.collaborationMembershipMessage[status]
            loginPrompt.style.display = 'block'
            inputArea.style.display = 'none'
            commentsList.innerHTML = ''
            emptyPrompt.style.display = 'none'
            return
          }
          // 获取用户数据库记录
          const { data } = await client
            .from('users')
            .select('id, username, avatar_url, role')
            .eq('id', currentUser.id)
            .single()
          currentUserDbRecord = data
          
          loginPrompt.style.display = 'none'
          inputArea.style.display = 'block'
        } else {
          currentUserDbRecord = null
          loginPrompt.textContent = '请先登录并获得管理员批准后参与评论'
          loginPrompt.style.display = 'block'
          inputArea.style.display = 'none'
        }
      }
      
      // 发表评论
      submitBtn.addEventListener('click', async () => {
        const content = commentInput.value.trim()
        if (!content || !currentUser) return
        
        submitBtn.disabled = true
        try {
          const { error } = await client.from('comments').insert({
            page_path: pagePath,
            content: content,
            author_id: currentUser.id,
          })
          if (error) throw error
          commentInput.value = ''
          await loadComments()
        } catch (err) {
          console.error('发表评论失败:', err)
          alert('发表失败，请重试')
        }
        submitBtn.disabled = false
      })
      
      const refreshBtn = container.querySelector('#refresh-comments')
      const onRefresh = async () => {
        refreshBtn.disabled = true
        await updateUserState()
        if (run === commentsRun && container.isConnected) await loadComments()
        refreshBtn.disabled = false
      }
      refreshBtn.addEventListener('click', onRefresh)

      // 监听登录状态变化
      const { data: authListener } = client.auth.onAuthStateChange(() => {
        if (run !== commentsRun || !container.isConnected) return
        setTimeout(async () => {
          await updateUserState()
          if (run === commentsRun && container.isConnected) await loadComments()
        }, 0)
      })
      window.addCleanup(() => {
        commentsRun++
        refreshBtn.removeEventListener('click', onRefresh)
        authListener?.subscription?.unsubscribe?.()
      })
      
      // 初始化
      await updateUserState()
      if (run !== commentsRun || !container.isConnected) return
      await loadComments()
    }

    document.addEventListener('nav', initSupaComments)
    initSupaComments()
  `

  return SupaComments
}) satisfies QuartzComponentConstructor<SupaCommentsOptions>
