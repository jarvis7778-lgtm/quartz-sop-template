import { FilePath, QUARTZ, joinSegments } from "../../util/path"
import { QuartzEmitterPlugin } from "../types"
import fs from "fs"
import { glob } from "../../util/glob"
import { dirname } from "path"

export const Static: QuartzEmitterPlugin = () => ({
  name: "Static",
  async *emit({ argv, cfg }) {
    const staticPath = joinSegments(QUARTZ, "static")
    const fps = await glob("**", staticPath, cfg.configuration.ignorePatterns)
    const outputStaticPath = joinSegments(argv.output, "static")
    await fs.promises.mkdir(outputStaticPath, { recursive: true })
    // KaTeX CSS refers to sibling fonts; preserve that directory structure.
    const katexPath = "node_modules/katex/dist"
    for (const file of [
      "katex.min.css",
      ...(await fs.promises.readdir(joinSegments(katexPath, "fonts"))).map(
        (name) => `fonts/${name}`,
      ),
    ]) {
      const dest = joinSegments(outputStaticPath, "katex", file) as FilePath
      await fs.promises.mkdir(dirname(dest), { recursive: true })
      await fs.promises.copyFile(joinSegments(katexPath, file), dest)
      yield dest
    }
    const licenseDest = joinSegments(outputStaticPath, "katex", "LICENSE") as FilePath
    await fs.promises.copyFile("node_modules/katex/LICENSE", licenseDest)
    yield licenseDest
    for (const fp of fps) {
      const src = joinSegments(staticPath, fp) as FilePath
      const dest = joinSegments(outputStaticPath, fp) as FilePath
      await fs.promises.mkdir(dirname(dest), { recursive: true })
      await fs.promises.copyFile(src, dest)
      yield dest
    }
  },
  async *partialEmit() {},
})
