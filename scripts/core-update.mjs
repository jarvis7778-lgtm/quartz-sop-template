#!/usr/bin/env node
/**
 * Bounded upstream-core synchronization.  Only paths accepted by `managed()`
 * can ever be read as upstream content or changed in a destination tree.
 */
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

const SCHEMA = 1
const LOCK_PATH = ".template/core-lock.json"
const DIRECT = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "globals.d.ts",
  "index.d.ts",
  ".node-version",
  ".npmrc",
  "scripts/core-update.mjs",
  "scripts/core-update.test.mjs",
  "scripts/check-template-update.mjs",
  "scripts/check-template-update.test.mjs",
  "scripts/verify-postgres-migrations.sh",
  "scripts/test-collab-security-postgres.sh",
  "scripts/serve-test-site.mjs",
  "scripts/build-showcase.mjs",
  "playwright.config.ts",
  "release-contracts.test.ts",
])
const SHA256 = /^[a-f0-9]{64}$/
const VERSION =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const COMMIT = /^[a-f0-9]{40}$/

export class CoreUpdateError extends Error {
  constructor(message) {
    super(message)
    this.name = "CoreUpdateError"
  }
}

/** True only for paths this updater is permitted to synchronize. */
export function managed(candidate) {
  if (typeof candidate !== "string" || candidate.includes("\\")) return false
  if (!safeRelative(candidate)) return false
  if (DIRECT.has(candidate)) return true
  if (candidate.startsWith("tests/browser/")) return candidate.length > "tests/browser/".length
  if (candidate.startsWith("themes/")) return candidate.length > "themes/".length
  if (candidate.startsWith("quartz/.quartz-cache/")) return false
  if (!candidate.startsWith("quartz/")) return false
  return candidate !== "quartz/styles/custom.scss" && !candidate.startsWith("quartz/static/")
}

function safeRelative(value) {
  if (!value || path.posix.isAbsolute(value)) return false
  const parts = value.split("/")
  return parts.every((part) => part && part !== "." && part !== "..")
}

function validateMetadata(source, version, commit) {
  if (typeof source !== "string" || !source.trim())
    throw new CoreUpdateError("invalid source metadata")
  if (typeof version !== "string" || !VERSION.test(version))
    throw new CoreUpdateError("invalid version metadata (expected vX.Y.Z)")
  if (typeof commit !== "string" || !COMMIT.test(commit))
    throw new CoreUpdateError("invalid commit metadata (expected 40 lowercase hex characters)")
}

function absolute(root) {
  if (typeof root !== "string" || !root) throw new CoreUpdateError("root must be a non-empty path")
  return path.resolve(root)
}

async function statRequired(target, label) {
  try {
    return await lstat(target)
  } catch (error) {
    if (error?.code === "ENOENT") throw new CoreUpdateError(`${label} does not exist: ${target}`)
    throw error
  }
}

async function assertNoSymlinkChain(target, label) {
  const resolved = path.resolve(target)
  const parsed = path.parse(resolved)
  let cursor = parsed.root
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  const rootStat = await statRequired(cursor, label)
  if (rootStat.isSymbolicLink())
    throw new CoreUpdateError(`symlink rejected in ${label}: ${cursor}`)
  for (const segment of segments) {
    cursor = path.join(cursor, segment)
    let entry
    try {
      entry = await lstat(cursor)
    } catch (error) {
      if (error?.code === "ENOENT") return
      throw error
    }
    if (entry.isSymbolicLink()) throw new CoreUpdateError(`symlink rejected in ${label}: ${cursor}`)
  }
}

async function assertDirectory(root, label) {
  await assertNoSymlinkChain(root, label)
  const entry = await statRequired(root, label)
  if (!entry.isDirectory()) throw new CoreUpdateError(`${label} must be a directory: ${root}`)
}

async function hashFile(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex")
}

async function walk(root, relative, results, label) {
  const directory = path.join(root, relative)
  await assertNoSymlinkChain(directory, label)
  let directoryInfo
  try {
    directoryInfo = await lstat(directory)
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  if (directoryInfo.isSymbolicLink())
    throw new CoreUpdateError(`symlink rejected in ${label}: ${relative || "."}`)
  if (!directoryInfo.isDirectory())
    throw new CoreUpdateError(`non-directory path rejected in ${label}: ${relative || "."}`)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    const full = path.join(root, child)
    const info = await lstat(full)
    if (info.isSymbolicLink()) throw new CoreUpdateError(`symlink rejected in ${label}: ${child}`)
    if (info.isDirectory()) await walk(root, child, results, label)
    else if (info.isFile()) results.push(child)
    else throw new CoreUpdateError(`non-regular file rejected in ${label}: ${child}`)
  }
}

async function collectManaged(root, label) {
  root = absolute(root)
  await assertDirectory(root, label)
  const all = []
  // Walk whole managed-prefix trees first so a symlink cannot hide in an excluded
  // subtree and later become part of an unsafe path through a race/change.
  await walk(root, "quartz", all, label)
  await walk(root, "themes", all, label)
  await walk(root, "tests/browser", all, label)
  for (const name of DIRECT) {
    const full = path.join(root, name)
    await assertNoSymlinkChain(full, `${label} direct path`)
    let info
    try {
      info = await lstat(full)
    } catch (error) {
      if (error?.code === "ENOENT") continue
      throw error
    }
    if (info.isSymbolicLink()) throw new CoreUpdateError(`symlink rejected in ${label}: ${name}`)
    if (!info.isFile()) throw new CoreUpdateError(`non-regular file rejected in ${label}: ${name}`)
    all.push(name)
  }
  const files = Object.create(null)
  for (const name of all)
    if (managed(name)) files[name] = { sha256: await hashFile(path.join(root, name)) }
  return files
}

function validateFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files))
    throw new CoreUpdateError("malformed lock files")
  const checked = Object.create(null)
  for (const [name, record] of Object.entries(files)) {
    if (
      !managed(name) ||
      !record ||
      typeof record !== "object" ||
      Object.keys(record).some((key) => key !== "sha256") ||
      typeof record.sha256 !== "string" ||
      !SHA256.test(record.sha256)
    ) {
      throw new CoreUpdateError(`malformed lock path or hash: ${name}`)
    }
    checked[name] = { sha256: record.sha256 }
  }
  return checked
}

function validateLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock) || lock.schema !== SCHEMA)
    throw new CoreUpdateError("malformed lock schema")
  validateMetadata(lock.source, lock.version, lock.commit)
  const allowed = new Set(["schema", "source", "version", "commit", "files"])
  if (Object.keys(lock).some((key) => !allowed.has(key)))
    throw new CoreUpdateError("malformed lock fields")
  return {
    schema: SCHEMA,
    source: lock.source,
    version: lock.version,
    commit: lock.commit,
    files: validateFiles(lock.files),
  }
}

async function readLock(root) {
  const lockFile = path.join(root, LOCK_PATH)
  await assertNoSymlinkChain(lockFile, "destination lock path")
  let text
  try {
    text = await readFile(lockFile, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new CoreUpdateError("missing .template/core-lock.json; run init or snapshot first")
    throw error
  }
  try {
    return validateLock(JSON.parse(text))
  } catch (error) {
    if (error instanceof CoreUpdateError) throw error
    throw new CoreUpdateError("malformed lock JSON")
  }
}

function conflictsForBaseline(baseline, current) {
  const conflicts = []
  for (const [name, record] of Object.entries(baseline)) {
    const present = current[name]
    if (!present) conflicts.push(`${name} (deleted locally)`)
    else if (present.sha256 !== record.sha256) conflicts.push(`${name} (changed locally)`)
  }
  for (const name of Object.keys(current))
    if (!baseline[name]) conflicts.push(`${name} (new managed file)`)
  return conflicts.sort()
}

function assertNoConflicts(conflicts) {
  if (conflicts.length)
    throw new CoreUpdateError(
      `conflicts detected; no files were changed:\n${conflicts.map((x) => `- ${x}`).join("\n")}`,
    )
}

async function atomicWrite(destination, contents, mode = 0o600) {
  const directory = path.dirname(destination)
  await assertNoSymlinkChain(destination, "destination path")
  await mkdir(directory, { recursive: true })
  await assertNoSymlinkChain(destination, "destination path")
  const existing = await lstat(destination).catch((error) => {
    if (error?.code === "ENOENT") return null
    throw error
  })
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new CoreUpdateError(`destination file is not regular: ${destination}`)
  const writeMode = existing ? existing.mode & 0o777 : mode
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.core-update-${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporary, contents, { mode: writeMode })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function makeLock(source, version, commit, files) {
  return { schema: SCHEMA, source, version, commit, files }
}

/** Create a lock for an upstream-owned source tree; never use this to adopt a downstream tree. */
export async function snapshot(root, source, version, commit) {
  validateMetadata(source, version, commit)
  root = absolute(root)
  await assertDirectory(root, "snapshot root")
  const lockFile = path.join(root, LOCK_PATH)
  await assertNoSymlinkChain(lockFile, "snapshot lock path")
  const files = await collectManaged(root, "snapshot source")
  await atomicWrite(
    lockFile,
    `${JSON.stringify(makeLock(source, version, commit, files), null, 2)}\n`,
  )
  return { mode: "snapshot", files: Object.keys(files).length }
}

/** Adopt an exact, clean downstream copy of source by recording its managed baseline. */
export async function init(root, source, version, commit) {
  validateMetadata(source, version, commit)
  root = absolute(root)
  source = absolute(source)
  await assertDirectory(root, "destination root")
  await assertDirectory(source, "source root")
  const lockFile = path.join(root, LOCK_PATH)
  await assertNoSymlinkChain(lockFile, "destination lock path")
  try {
    await lstat(lockFile)
    throw new CoreUpdateError("lock already exists; refusing to replace baseline")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  const upstream = await collectManaged(source, "source")
  const destination = await collectManaged(root, "destination")
  const differences = []
  for (const [name, record] of Object.entries(upstream)) {
    if (!destination[name]) differences.push(`${name} (missing from destination)`)
    else if (destination[name].sha256 !== record.sha256)
      differences.push(`${name} (differs from source)`)
  }
  for (const name of Object.keys(destination))
    if (!upstream[name]) differences.push(`${name} (new managed file)`)
  assertNoConflicts(differences.sort())
  await atomicWrite(
    lockFile,
    `${JSON.stringify(makeLock(source, version, commit, upstream), null, 2)}\n`,
  )
  return { mode: "init", files: Object.keys(upstream).length }
}

/** Safely synchronize only an unchanged managed baseline to a newer source tree. */
export async function apply(root, source, version, commit) {
  validateMetadata(source, version, commit)
  root = absolute(root)
  source = absolute(source)
  await assertDirectory(root, "destination root")
  await assertDirectory(source, "source root")
  const baseline = await readLock(root)
  const current = await collectManaged(root, "destination")
  assertNoConflicts(conflictsForBaseline(baseline.files, current))
  const upstream = await collectManaged(source, "source")

  // Complete all conflict/security discovery before the first destination mutation.
  // Source files are all hashed/read during collection, then read once more only as
  // immutable input for the already-approved write set.
  const added = [],
    updated = [],
    removed = []
  for (const [name, record] of Object.entries(upstream)) {
    if (!baseline.files[name]) added.push(name)
    else if (baseline.files[name].sha256 !== record.sha256) updated.push(name)
  }
  for (const name of Object.keys(baseline.files)) if (!upstream[name]) removed.push(name)

  for (const name of [...added, ...updated].sort()) {
    const input = path.join(source, name)
    await assertNoSymlinkChain(input, "source file")
    const info = await statRequired(input, "source file")
    if (!info.isFile() || info.isSymbolicLink())
      throw new CoreUpdateError(`source file is not regular: ${name}`)
    await atomicWrite(path.join(root, name), await readFile(input), info.mode & 0o777)
  }
  for (const name of removed.sort()) {
    const destination = path.join(root, name)
    await assertNoSymlinkChain(destination, "destination removal path")
    await unlink(destination)
  }
  await atomicWrite(
    path.join(root, LOCK_PATH),
    `${JSON.stringify(makeLock(source, version, commit, upstream), null, 2)}\n`,
  )
  return { mode: "apply", added: added.length, updated: updated.length, removed: removed.length }
}

function usage() {
  return "usage: node scripts/core-update.mjs <init|apply|snapshot> --root <dir> --source <dir-or-identity> --version vX.Y.Z --commit <40-lowercase-hex>"
}

async function cli(argv) {
  const [mode, ...rest] = argv
  const values = Object.create(null)
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i],
      value = rest[i + 1]
    if (!key?.startsWith("--") || value === undefined || values[key])
      throw new CoreUpdateError(usage())
    values[key] = value
  }
  if (
    !mode ||
    !["init", "apply", "snapshot"].includes(mode) ||
    Object.keys(values).length !== 4 ||
    !values["--root"] ||
    !values["--source"] ||
    !values["--version"] ||
    !values["--commit"]
  )
    throw new CoreUpdateError(usage())
  const operation = { init, apply, snapshot }[mode]
  return operation(values["--root"], values["--source"], values["--version"], values["--commit"])
}

if (import.meta.main) {
  cli(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
