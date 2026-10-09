import assert from "node:assert/strict"
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { lstatSync } from "node:fs"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { apply, init, managed, snapshot } from "./core-update.mjs"

test("generated Quartz cache is never managed", async () => {
  assert.equal(managed("quartz/.quartz-cache/transpiled-build.mjs"), false)
  const root = await tree({
    "quartz/core.ts": "code",
    "quartz/.quartz-cache/build.mjs": "generated",
  })
  try {
    await snapshot(root, "fixture", "v0.0.0", "a".repeat(40))
    assert.deepEqual(Object.keys((await lock(root)).files), ["quartz/core.ts"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const COMMIT_A = "a".repeat(40)
const COMMIT_B = "b".repeat(40)
const VERSION = "v0.0.0"

async function tree(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "core-update-"))
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
  }
  return root
}

async function file(root, name) {
  return readFile(path.join(root, name), "utf8")
}

async function lock(root) {
  return JSON.parse(await file(root, ".template/core-lock.json"))
}

const upstreamV1 = {
  "quartz/core.ts": "export const core = 1\n",
  "quartz/styles/base.scss": "body { color: black }\n",
  "quartz/styles/custom.scss": "user css\n",
  "quartz/static/logo.svg": "user asset\n",
  "themes/default.scss": "theme v1\n",
  "package.json": '{"name":"fixture","version":"0.0.0"}\n',
  "package-lock.json": '{"lockfileVersion":3}\n',
  "tsconfig.json": '{"compilerOptions":{}}\n',
  "globals.d.ts": "declare const x: string\n",
  "index.d.ts": "export {}\n",
  ".node-version": "22\n",
  ".npmrc": "fund=false\n",
  "scripts/core-update.mjs": "// updater v1\n",
  "scripts/core-update.test.mjs": "// updater test v1\n",
  "scripts/check-template-update.mjs": "// checker v1\n",
  "scripts/check-template-update.test.mjs": "// checker test v1\n",
  "scripts/verify-postgres-migrations.sh": "#!/bin/sh\ntrue\n",
  "scripts/test-collab-security-postgres.sh": "#!/bin/sh\ntrue\n",
  "scripts/serve-test-site.mjs": "// server v1\n",
  "scripts/build-showcase.mjs": "// showcase v1\n",
  "playwright.config.ts": "export default {}\n",
  "release-contracts.test.ts": "export {}\n",
  "tests/browser/smoke.test.ts": "export {}\n",
  "scripts/custom-user-script.mjs": "user-owned\n",
  "docs/ignored.md": "not managed\n",
}

const upstreamV2 = {
  ...upstreamV1,
  "quartz/core.ts": "export const core = 2\n",
  "quartz/new.ts": "export const added = true\n",
  "themes/default.scss": "theme v2\n",
  "scripts/check-template-update.mjs": "// checker v2\n",
  "scripts/check-template-update.test.mjs": "// checker test v2\n",
  "tests/browser/new.test.ts": "export const added = true\n",
}
delete upstreamV2["package-lock.json"]

async function adoptedPair() {
  const source = await tree(upstreamV1)
  const destination = await tree({
    ...upstreamV1,
    "quartz/styles/custom.scss": "my css\n",
    "quartz/static/logo.svg": "my logo\n",
  })
  await init(destination, source, VERSION, COMMIT_A)
  return { source, destination }
}

async function cleanup(...roots) {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
}

test("managed bounds scope and excludes user-owned paths", () => {
  assert.equal(managed("quartz/core.ts"), true)
  assert.equal(managed("quartz/styles/custom.scss"), false)
  assert.equal(managed("quartz/static/logo.svg"), false)
  assert.equal(managed("themes/default.scss"), true)
  assert.equal(managed("scripts/core-update.mjs"), true)
  assert.equal(managed("scripts/core-update.test.mjs"), true)
  assert.equal(managed("scripts/check-template-update.mjs"), true)
  assert.equal(managed("scripts/check-template-update.test.mjs"), true)
  assert.equal(managed("scripts/verify-postgres-migrations.sh"), true)
  assert.equal(managed("scripts/test-collab-security-postgres.sh"), true)
  assert.equal(managed("scripts/serve-test-site.mjs"), true)
  assert.equal(managed("scripts/build-showcase.mjs"), true)
  assert.equal(managed("playwright.config.ts"), true)
  assert.equal(managed("release-contracts.test.ts"), true)
  assert.equal(managed("tests/browser/smoke.test.ts"), true)
  assert.equal(managed("scripts/other.mjs"), false)
  assert.equal(managed("scripts/custom-user-script.mjs"), false)
  assert.equal(managed(".github/workflows/ci.yaml"), false)
  assert.equal(managed("docs/ignored.md"), false)
  assert.equal(managed("../package.json"), false)
})

test("snapshot records only managed regular files and validated metadata", async () => {
  const source = await tree(upstreamV1)
  try {
    const result = await snapshot(source, "fixture-source", VERSION, COMMIT_A)
    assert.equal(result.mode, "snapshot")
    const recorded = await lock(source)
    assert.equal(recorded.files["scripts/check-template-update.mjs"].sha256.length, 64)
    assert.equal(recorded.files["scripts/check-template-update.test.mjs"].sha256.length, 64)
    assert.equal(recorded.files["tests/browser/smoke.test.ts"].sha256.length, 64)
    assert.equal(recorded.files["scripts/custom-user-script.mjs"], undefined)
    assert.equal(recorded.source, "fixture-source")
    assert.equal(recorded.version, VERSION)
    assert.equal(recorded.commit, COMMIT_A)
    assert.equal(recorded.schema, 1)
  } finally {
    await cleanup(source)
  }
})

test("snapshot permits absent managed prefix directories", async () => {
  const source = await tree({ "quartz/core.ts": "minimal\n" })
  try {
    await snapshot(source, "minimal-source", VERSION, COMMIT_A)
    assert.deepEqual(Object.keys((await lock(source)).files), ["quartz/core.ts"])
  } finally {
    await cleanup(source)
  }
})

test("init writes an adoption lock without mutating matching managed files", async () => {
  const source = await tree(upstreamV1)
  const destination = await tree({
    ...upstreamV1,
    "quartz/styles/custom.scss": "mine\n",
    "quartz/static/logo.svg": "mine svg\n",
  })
  try {
    const before = await file(destination, "quartz/core.ts")
    const result = await init(destination, source, VERSION, COMMIT_A)
    assert.equal(result.mode, "init")
    assert.equal(await file(destination, "quartz/core.ts"), before)
    assert.equal((await lock(destination)).commit, COMMIT_A)
  } finally {
    await cleanup(source, destination)
  }
})

test("init refuses a managed difference and leaves no lock", async () => {
  const source = await tree(upstreamV1)
  const destination = await tree({ ...upstreamV1, "quartz/core.ts": "local change\n" })
  try {
    await assert.rejects(init(destination, source, VERSION, COMMIT_A), /conflict/i)
    await assert.rejects(file(destination, ".template/core-lock.json"), /ENOENT/)
  } finally {
    await cleanup(source, destination)
  }
})

test("apply adds updates and removes only baseline files, preserving protected content", async () => {
  const { source, destination } = await adoptedPair()
  const next = await tree(upstreamV2)
  try {
    const beforeCustom = await file(destination, "quartz/styles/custom.scss")
    const beforeStatic = await file(destination, "quartz/static/logo.svg")
    const result = await apply(destination, next, VERSION, COMMIT_B)
    assert.deepEqual(result, { mode: "apply", added: 2, updated: 4, removed: 1 })
    assert.equal(await file(destination, "quartz/core.ts"), "export const core = 2\n")
    assert.equal(await file(destination, "quartz/new.ts"), "export const added = true\n")
    await assert.rejects(file(destination, "package-lock.json"), /ENOENT/)
    assert.equal(await file(destination, "quartz/styles/custom.scss"), beforeCustom)
    assert.equal(await file(destination, "quartz/static/logo.svg"), beforeStatic)
    const recorded = await lock(destination)
    assert.equal(recorded.commit, COMMIT_B)
    assert.equal(recorded.files["quartz/new.ts"].sha256.length, 64)
    assert.equal(await file(destination, "scripts/check-template-update.mjs"), "// checker v2\n")
    assert.equal(
      await file(destination, "scripts/check-template-update.test.mjs"),
      "// checker test v2\n",
    )
    assert.equal(
      await file(destination, "tests/browser/new.test.ts"),
      "export const added = true\n",
    )
    assert.equal(await file(destination, "scripts/custom-user-script.mjs"), "user-owned\n")
    assert.equal(recorded.files["package-lock.json"], undefined)
  } finally {
    await cleanup(source, destination, next)
  }
})

test("apply is idempotent after a successful update", async () => {
  const { source, destination } = await adoptedPair()
  const next = await tree(upstreamV2)
  try {
    await apply(destination, next, VERSION, COMMIT_B)
    assert.deepEqual(await apply(destination, next, VERSION, COMMIT_B), {
      mode: "apply",
      added: 0,
      updated: 0,
      removed: 0,
    })
  } finally {
    await cleanup(source, destination, next)
  }
})

test("apply reports changed deleted and unknown managed paths before making any write", async () => {
  const { source, destination } = await adoptedPair()
  const next = await tree(upstreamV2)
  try {
    await writeFile(path.join(destination, "quartz/core.ts"), "local edit\n")
    await rm(path.join(destination, "themes/default.scss"))
    await writeFile(path.join(destination, "quartz/local.ts"), "unknown\n")
    const oldLock = await file(destination, ".template/core-lock.json")
    await assert.rejects(apply(destination, next, VERSION, COMMIT_B), (error) => {
      assert.match(error.message, /quartz\/core\.ts/)
      assert.match(error.message, /themes\/default\.scss/)
      assert.match(error.message, /quartz\/local\.ts/)
      return true
    })
    assert.equal(await file(destination, "quartz/core.ts"), "local edit\n")
    assert.equal(await file(destination, ".template/core-lock.json"), oldLock)
    assert.equal(lstatSync(path.join(destination, "package-lock.json")).isFile(), true)
  } finally {
    await cleanup(source, destination, next)
  }
})

test("apply treats a customized package manifest as a reviewed-adoption conflict", async () => {
  const { source, destination } = await adoptedPair()
  const next = await tree(upstreamV2)
  try {
    await writeFile(
      path.join(destination, "package.json"),
      '{"scripts":{"build:showcase":"custom"}}\n',
    )
    await assert.rejects(
      apply(destination, next, VERSION, COMMIT_B),
      /package\.json \(changed locally\)/,
    )
    assert.equal(
      await file(destination, "package.json"),
      '{"scripts":{"build:showcase":"custom"}}\n',
    )
    assert.equal((await lock(destination)).commit, COMMIT_A)
  } finally {
    await cleanup(source, destination, next)
  }
})

test("apply rejects malformed locks and traversal entries without writes", async () => {
  const { source, destination } = await adoptedPair()
  const next = await tree(upstreamV2)
  try {
    const lockPath = path.join(destination, ".template/core-lock.json")
    const before = await file(destination, "quartz/core.ts")
    await writeFile(
      lockPath,
      JSON.stringify({
        schema: 1,
        source: "x",
        version: VERSION,
        commit: COMMIT_A,
        files: { "../escape": { sha256: "a".repeat(64) } },
      }),
    )
    await assert.rejects(apply(destination, next, VERSION, COMMIT_B), /invalid|malformed|path/i)
    assert.equal(await file(destination, "quartz/core.ts"), before)
  } finally {
    await cleanup(source, destination, next)
  }
})

test("apply rejects symlinks in destination chains and source managed files", async () => {
  const { source, destination } = await adoptedPair()
  const next = await tree(upstreamV2)
  const external = await tree({ "outside.ts": "outside\n" })
  try {
    await rm(path.join(destination, "quartz"), { recursive: true })
    await symlink(external, path.join(destination, "quartz"))
    await assert.rejects(apply(destination, next, VERSION, COMMIT_B), /symlink/i)
  } finally {
    await cleanup(source, destination, next, external)
  }

  const pair = await adoptedPair()
  const symlinkSource = await tree(upstreamV2)
  try {
    await rm(path.join(symlinkSource, "quartz/core.ts"))
    await symlink("../themes/default.scss", path.join(symlinkSource, "quartz/core.ts"))
    await assert.rejects(apply(pair.destination, symlinkSource, VERSION, COMMIT_B), /symlink/i)
  } finally {
    await cleanup(pair.source, pair.destination, symlinkSource)
  }
})

test("apply rejects a source direct script below a symlinked ancestor before writes", async () => {
  const source = await tree(upstreamV1)
  const destination = await tree(upstreamV1)
  const next = await tree(upstreamV2)
  const external = await tree({ "check-template-update.mjs": "escaped checker\n" })
  try {
    await init(destination, source, VERSION, COMMIT_A)
    await rm(path.join(next, "scripts"), { recursive: true })
    await symlink(external, path.join(next, "scripts"))
    const beforeCore = await file(destination, "quartz/core.ts")
    const beforeLock = await file(destination, ".template/core-lock.json")
    await assert.rejects(apply(destination, next, VERSION, COMMIT_B), /symlink/i)
    assert.equal(await file(destination, "quartz/core.ts"), beforeCore)
    assert.equal(await file(destination, ".template/core-lock.json"), beforeLock)
  } finally {
    await cleanup(source, destination, next, external)
  }
})

test("apply rejects a destination direct script below a symlinked ancestor before writes", async () => {
  const source = await tree(upstreamV1)
  const destination = await tree(upstreamV1)
  const next = await tree(upstreamV2)
  const external = await tree({ "check-template-update.mjs": "escaped checker\n" })
  try {
    await init(destination, source, VERSION, COMMIT_A)
    await rm(path.join(destination, "scripts"), { recursive: true })
    await symlink(external, path.join(destination, "scripts"))
    const beforeLock = await file(destination, ".template/core-lock.json")
    await assert.rejects(apply(destination, next, VERSION, COMMIT_B), /symlink/i)
    assert.equal(await file(destination, ".template/core-lock.json"), beforeLock)
    assert.equal(await file(external, "check-template-update.mjs"), "escaped checker\n")
  } finally {
    await cleanup(source, destination, next, external)
  }
})

test("apply rejects browser files below symlinked source and destination ancestors before writes", async () => {
  const sourcePair = await adoptedPair()
  const sourceNext = await tree(upstreamV2)
  const sourceExternal = await tree({ "browser/new.test.ts": "escaped browser source\n" })
  try {
    await rm(path.join(sourceNext, "tests"), { recursive: true })
    await symlink(sourceExternal, path.join(sourceNext, "tests"))
    const beforeCore = await file(sourcePair.destination, "quartz/core.ts")
    const beforeLock = await file(sourcePair.destination, ".template/core-lock.json")
    await assert.rejects(apply(sourcePair.destination, sourceNext, VERSION, COMMIT_B), /symlink/i)
    assert.equal(await file(sourcePair.destination, "quartz/core.ts"), beforeCore)
    assert.equal(await file(sourcePair.destination, ".template/core-lock.json"), beforeLock)
  } finally {
    await cleanup(sourcePair.source, sourcePair.destination, sourceNext, sourceExternal)
  }

  const destinationPair = await adoptedPair()
  const destinationNext = await tree(upstreamV2)
  const destinationExternal = await tree({
    "browser/smoke.test.ts": "escaped browser destination\n",
  })
  try {
    await rm(path.join(destinationPair.destination, "tests"), { recursive: true })
    await symlink(destinationExternal, path.join(destinationPair.destination, "tests"))
    const beforeLock = await file(destinationPair.destination, ".template/core-lock.json")
    await assert.rejects(
      apply(destinationPair.destination, destinationNext, VERSION, COMMIT_B),
      /symlink/i,
    )
    assert.equal(await file(destinationPair.destination, ".template/core-lock.json"), beforeLock)
    assert.equal(
      await file(destinationExternal, "browser/smoke.test.ts"),
      "escaped browser destination\n",
    )
  } finally {
    await cleanup(
      destinationPair.source,
      destinationPair.destination,
      destinationNext,
      destinationExternal,
    )
  }
})

test("apply preserves existing executable mode and uses source mode for added executable scripts", async () => {
  const sourceV1 = { ...upstreamV1 }
  const destinationV1 = { ...upstreamV1 }
  delete sourceV1["scripts/build-showcase.mjs"]
  delete destinationV1["scripts/build-showcase.mjs"]
  delete sourceV1["quartz/executable.mjs"]
  delete destinationV1["quartz/executable.mjs"]
  const source = await tree(sourceV1)
  const destination = await tree(destinationV1)
  const next = await tree({
    ...upstreamV2,
    "scripts/build-showcase.mjs": "#!/usr/bin/env node\n// showcase v2\n",
    "quartz/executable.mjs": "#!/usr/bin/env node\n",
  })
  try {
    await init(destination, source, VERSION, COMMIT_A)
    await chmod(path.join(destination, "scripts/check-template-update.mjs"), 0o755)
    await chmod(path.join(next, "scripts/check-template-update.mjs"), 0o644)
    await chmod(path.join(next, "scripts/build-showcase.mjs"), 0o751)
    await chmod(path.join(next, "quartz/executable.mjs"), 0o711)
    await apply(destination, next, VERSION, COMMIT_B)
    assert.equal(
      (await stat(path.join(destination, "scripts/check-template-update.mjs"))).mode & 0o777,
      0o755,
    )
    assert.equal(
      (await stat(path.join(destination, "scripts/build-showcase.mjs"))).mode & 0o777,
      0o751,
    )
    assert.equal((await stat(path.join(destination, "quartz/executable.mjs"))).mode & 0o777, 0o711)
  } finally {
    await cleanup(source, destination, next)
  }
})

test("metadata must use v-prefixed semver and a full lowercase commit", async () => {
  const source = await tree(upstreamV1)
  try {
    await assert.rejects(snapshot(source, "x", "0.0.0", COMMIT_A), /version/i)
    await assert.rejects(snapshot(source, "x", VERSION, "ABC"), /commit/i)
  } finally {
    await cleanup(source)
  }
})

test("CLI requires explicit named root source version and commit arguments", () => {
  const script = path.resolve("scripts/core-update.mjs")
  const result = spawnSync(process.execPath, [script, "snapshot", "--root", "."], {
    encoding: "utf8",
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /usage:/i)
})
