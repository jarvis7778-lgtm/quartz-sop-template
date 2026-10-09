import test from "node:test"
import assert from "node:assert/strict"
import { selectRelease, compareVersions } from "./check-template-update.mjs"
const release = (tag) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/jarvis7778-lgtm/quartz-sop-template/releases/tag/${tag}`,
  body: "Changes",
})
test("selects newer stable release and reports no downgrade", () => {
  assert.equal(selectRelease("v1.0.0", release("v1.1.0")).available, true)
  assert.equal(selectRelease("v1.1.0", release("v1.1.0")).available, false)
  assert.equal(selectRelease("v2.0.0", release("v1.1.0")).available, false)
  assert.equal(compareVersions("v1.10.0", "v1.9.0"), 1)
})
test("rejects malformed metadata, draft, prerelease and release URL substitution", () => {
  for (const tag of ["v01.0.0", "v1.0.0;touch x", "../../x", "main", "v1.0.0-beta.1"])
    assert.throws(() => selectRelease("v0.0.0", release(tag)))
  for (const change of [{ draft: true }, { prerelease: true }, { html_url: "https://evil.test" }])
    assert.throws(() => selectRelease("v0.0.0", { ...release("v1.0.0"), ...change }))
})
test("no releases is not an available update", () =>
  assert.deepEqual(selectRelease("v0.0.0", null), { available: false, reason: "no-release" }))
