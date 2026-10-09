import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import yaml from "js-yaml"

test("update proposal requires a successful read-only preparation job", () => {
  const w = yaml.load(
    fs.readFileSync(new URL("../.github/workflows/template-update.yaml", import.meta.url), "utf8"),
  )
  assert.equal(w.permissions.contents, "read")
  assert.equal(w.jobs.propose.needs, "prepare")
  assert.equal(w.jobs.propose.permissions["pull-requests"], "write")
  assert.ok(
    !w.jobs.prepare.permissions?.["contents"] || w.jobs.prepare.permissions.contents === "read",
  )
  const steps = w.jobs.prepare.steps
  const validate = steps.findIndex((s) => s.name?.startsWith("Validate candidate"))
  const upload = steps.findIndex((s) => s.uses?.startsWith("actions/upload-artifact"))
  assert.ok(validate >= 0 && upload > validate)
  assert.match(steps[validate].run, /npx quartz build/)
  assert.equal(steps[validate]["continue-on-error"], undefined)
  assert.equal(steps[upload].if, "steps.check.outputs.available == 'true'")
  assert.ok(
    steps
      .filter((s) => s.uses?.startsWith("actions/checkout"))
      .every((s) => s.with["persist-credentials"] === false),
  )
  const propose = w.jobs.propose.steps.find((s) => s.run?.includes("gh pr create")).run
  assert.match(propose, /git apply --index/)
  assert.doesNotMatch(propose, /npm |npx |node |--force|gh pr merge/)
})
