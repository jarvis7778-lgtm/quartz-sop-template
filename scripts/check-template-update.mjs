import fs from "node:fs/promises"
import { pathToFileURL } from "node:url"

export const UPSTREAM = "jarvis7778-lgtm/quartz-sop-template"
function versionParts(value) {
  if (typeof value !== "string" || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error(`Invalid stable version: ${value}`)
  return value.slice(1).split(".").map(BigInt)
}
export function compareVersions(a, b) {
  const left = versionParts(a),
    right = versionParts(b)
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  return 0
}
export function selectRelease(current, release) {
  versionParts(current)
  if (release === null) return { available: false, reason: "no-release" }
  const tag = release.tag_name
  versionParts(tag)
  if (
    release.draft !== false ||
    release.prerelease !== false ||
    release.html_url !== `https://github.com/${UPSTREAM}/releases/tag/${tag}`
  )
    throw new Error("Not an official stable release")
  return { available: compareVersions(tag, current) > 0, version: tag, url: release.html_url }
}
async function main() {
  const lock = JSON.parse(await fs.readFile(".template/core-lock.json", "utf8"))
  const response = await fetch(`https://api.github.com/repos/${UPSTREAM}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
    },
  })
  if (!response.ok && response.status !== 404)
    throw new Error(`GitHub release check failed: HTTP ${response.status}`)
  const result = selectRelease(lock.version, response.status === 404 ? null : await response.json())
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `available=${result.available}\nversion=${result.version || ""}\n`,
    )
  if (process.env.GITHUB_STEP_SUMMARY)
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Template update\nInstalled: ${lock.version}\n\n${result.available ? `New release: [${result.version}](${result.url}). Preparing a checked update PR.` : "No newer stable release found."}\n`,
    )
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
