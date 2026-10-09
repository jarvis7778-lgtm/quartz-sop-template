/**
 * 锚点序列化/反序列化
 *
 * 将浏览器 Range 对象转化为可持久化的 JSON 数据，
 * 并在页面重新加载后还原回 Range。
 *
 * 策略：
 *   1. 主方案：CSS 选择器路径 + 文本节点偏移
 *   2. 回退方案：用 quote 文本做模糊全文搜索
 */

import type { AnchorData } from "./types"

/** 文章根元素选择器 */
const ARTICLE_SELECTOR = ".center > article.popover-hint"

/** 获取文章根元素 */
export function getArticleRoot(): HTMLElement | null {
  return document.querySelector(ARTICLE_SELECTOR)
}

/**
 * 为一个节点生成相对于 root 的 CSS 选择器路径
 *
 * 例如: "p:nth-child(3)" 或 "ul:nth-child(5) > li:nth-child(2)"
 */
function getCssPath(node: Node, root: HTMLElement): string {
  // 如果是文本节点，先定位其父元素
  let element: HTMLElement
  let textNodeIndex = -1

  if (node.nodeType === Node.TEXT_NODE) {
    element = node.parentElement!
    if (!element) return ""
    // 记录该文本节点在父元素内的索引
    const children = Array.from(element.childNodes)
    let textCount = 0
    for (let i = 0; i < children.length; i++) {
      if (children[i].nodeType === Node.TEXT_NODE) {
        if (children[i] === node) {
          textNodeIndex = textCount
          break
        }
        textCount++
      }
    }
  } else {
    element = node as HTMLElement
  }

  const parts: string[] = []
  let current: HTMLElement | null = element

  while (current && current !== root && root.contains(current)) {
    const parent: HTMLElement | null = current.parentElement
    if (!parent) break

    const tag = current.tagName.toLowerCase()
    // 计算同类型兄弟中的索引
    const siblings = Array.from(parent.children).filter(
      (el: Element) => el.tagName.toLowerCase() === tag,
    )

    if (siblings.length === 1) {
      parts.unshift(tag)
    } else {
      const index = siblings.indexOf(current) + 1
      parts.unshift(`${tag}:nth-of-type(${index})`)
    }

    current = parent
    if (current === root) break
  }

  let path = parts.join(" > ")
  if (textNodeIndex >= 0) {
    path += `::text(${textNodeIndex})`
  }
  return path
}

/**
 * 根据 CSS 路径解析出 DOM 节点
 */
function resolveFromCssPath(
  path: string,
  root: HTMLElement,
): { node: Node; isText: boolean } | null {
  // 检查是否指向文本节点
  const textMatch = path.match(/^(.+?)::text\((\d+)\)$/)
  const cssPath = textMatch ? textMatch[1] : path
  const textIndex = textMatch ? parseInt(textMatch[2]) : -1

  if (!cssPath) return null

  let element: Element | null
  try {
    element = root.querySelector(cssPath)
  } catch {
    return null
  }

  if (!element) return null

  if (textIndex >= 0) {
    // 找到指定索引的文本节点
    const textNodes: Text[] = []
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        textNodes.push(child as Text)
      }
    }
    if (textIndex < textNodes.length) {
      return { node: textNodes[textIndex], isText: true }
    }
    // 索引越界，返回第一个文本节点
    if (textNodes.length > 0) {
      return { node: textNodes[0], isText: true }
    }
    // 没有文本节点，返回元素本身
    return { node: element, isText: false }
  }

  return { node: element, isText: false }
}

/**
 * 将浏览器 Selection Range 序列化为 AnchorData
 */
export function serializeRange(range: Range, root: HTMLElement): AnchorData {
  const text = range.toString()

  return {
    startContainer: getCssPath(range.startContainer, root),
    startOffset: range.startOffset,
    endContainer: getCssPath(range.endContainer, root),
    endOffset: range.endOffset,
    text,
  }
}

/**
 * 将 AnchorData 反序列化为浏览器 Range
 *
 * 优先使用 CSS 路径精确还原，失败时用文本模糊搜索回退。
 */
export function deserializeAnchor(anchor: AnchorData, root: HTMLElement): Range | null {
  // 方案 1: CSS 路径精确还原
  const startResult = resolveFromCssPath(anchor.startContainer, root)
  const endResult = resolveFromCssPath(anchor.endContainer, root)

  if (startResult && endResult) {
    try {
      const range = document.createRange()

      const startNode = startResult.node
      const endNode = endResult.node

      // 验证偏移量有效
      const startLen =
        startNode.nodeType === Node.TEXT_NODE
          ? (startNode as Text).length
          : startNode.childNodes.length
      const endLen =
        endNode.nodeType === Node.TEXT_NODE ? (endNode as Text).length : endNode.childNodes.length

      range.setStart(startNode, Math.min(anchor.startOffset, startLen))
      range.setEnd(endNode, Math.min(anchor.endOffset, endLen))

      // 验证还原的文本是否大致匹配
      const restored = range.toString()
      if (anchor.text && restored && isSimilar(restored, anchor.text)) {
        return range
      }

      // A surviving DOM path is not evidence that its text is still the quote.
    } catch (e) {
      console.warn("[annotation] CSS 路径还原失败:", e)
    }
  }

  // 方案 2: 模糊文本搜索回退
  if (anchor.text) {
    return findTextInNode(root, anchor.text)
  }

  return null
}

/**
 * 在 root 下搜索包含指定文本的 Range
 * 使用 TreeWalker 遍历所有文本节点拼接后匹配
 */
function findTextInNode(root: HTMLElement, searchText: string): Range | null {
  if (!searchText || searchText.length === 0) return null

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let fullText = ""

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    textNodes.push(node)
    fullText += node.textContent || ""
  }

  // 在拼接文本中搜索
  const normalizedSearch = searchText.replace(/\s+/g, " ").trim()
  const normalizedFull = fullText.replace(/\s+/g, " ")

  // 需要映射规范化后的位置到原始位置
  // 简化方案：在原始文本中搜索
  const idx = fullText.indexOf(searchText)
  if (idx === -1) {
    // 尝试空白规范化后搜索
    const normalIdx = normalizedFull.indexOf(normalizedSearch)
    if (normalIdx === -1) return null
    // 规范化搜索命中，但位置映射复杂，简单回退
    return findByNormalizedText(textNodes, normalizedSearch)
  }

  // Repeated quotes are ambiguous after a path changes; never guess.
  if (fullText.indexOf(searchText, idx + 1) !== -1) return null
  return textOffsetToRange(textNodes, idx, idx + searchText.length)
}

/**
 * 将文本偏移量映射到 Range
 */
function textOffsetToRange(
  textNodes: Text[],
  startOffset: number,
  endOffset: number,
): Range | null {
  let accumulated = 0
  let startNode: Text | null = null
  let startLocal = 0
  let endNode: Text | null = null
  let endLocal = 0

  for (const node of textNodes) {
    const len = (node.textContent || "").length
    if (!startNode && accumulated + len > startOffset) {
      startNode = node
      startLocal = startOffset - accumulated
    }
    if (!endNode && accumulated + len >= endOffset) {
      endNode = node
      endLocal = endOffset - accumulated
      break
    }
    accumulated += len
  }

  if (!startNode || !endNode) return null

  try {
    const range = document.createRange()
    range.setStart(startNode, startLocal)
    range.setEnd(endNode, endLocal)
    return range
  } catch {
    return null
  }
}

/**
 * 规范化文本搜索（处理空白差异）
 */
function findByNormalizedText(textNodes: Text[], searchText: string): Range | null {
  const raw = textNodes.map((node) => node.textContent || "").join("")
  const positions: Array<{ start: number; end: number }> = []
  let normalized = ""
  for (const match of raw.matchAll(/\s+|[^\s]/gu)) {
    const whitespace = /\s/.test(match[0])
    normalized += whitespace ? " " : match[0]
    // Range offsets use UTF-16 units, including surrogate pairs.
    for (let unit = 0; unit < (whitespace ? 1 : match[0].length); unit++) {
      positions.push({
        start: match.index + unit,
        end: match.index + (whitespace ? match[0].length : unit + 1),
      })
    }
  }
  const start = normalized.indexOf(searchText)
  if (start < 0 || normalized.indexOf(searchText, start + 1) !== -1) return null
  return textOffsetToRange(
    textNodes,
    positions[start].start,
    positions[start + searchText.length - 1].end,
  )
}

/**
 * 简单的文本相似度比较
 */
function isSimilar(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, " ").trim()
  const nb = b.replace(/\s+/g, " ").trim()
  return na.length > 0 && na === nb
}
