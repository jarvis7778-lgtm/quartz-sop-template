import assert from "node:assert/strict"
import test from "node:test"
import katex from "katex"

test("math rendering ignores inherited trust settings", () => {
  const options = Object.create({ trust: true })
  options.throwOnError = false
  const result = katex.renderToString(String.raw`\href{https://example.test}{hello}`, options)
  assert.doesNotMatch(result, /<a\s[^>]*href=/)
})

test("standard inline, display and custom macro math remain supported", () => {
  for (const expression of [
    String.raw`\frac{1}{\sigma\sqrt{2\pi}}`,
    String.raw`\int_{-\infty}^{\infty} e^{-x^2}\, dx`,
    String.raw`\R^n`,
  ]) {
    const result = katex.renderToString(expression, {
      displayMode: true,
      macros: { "\\R": "\\mathbb{R}" },
    })
    assert.match(result, /katex/)
    assert.doesNotMatch(result, /katex-error/)
  }
})
