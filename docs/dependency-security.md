# Dependency security notes

## Reviewed remediation

KaTeX is pinned through a narrow npm override to **0.18.2**, the patched version for [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7). The inherited renderer-options regression failed on 0.16.47 and passes on 0.18.2. Inline/display/custom-macro math, Mermaid flow rendering and actual locally loaded fonts are covered by tests. Revisit this override when upstream Mermaid/rehype/remark packages adopt the fixed series. It is not a blanket `audit fix --force` downgrade.

KaTeX CSS, fonts and upstream LICENSE are copied into `static/katex/`. CSS stays external to avoid HTML escaping of CSS quotes and incorrect nested-page font URLs.

## Remaining advisories

At verification time, `npm audit --omit=dev` flags eight packages (four high, four moderate), grouped into two dependency chains:

- `braces` → `micromatch` / `fast-glob` / `globby`: nested-pattern recursion/DoS; registry latest braces remains 3.0.3. This is a Node build-time path, not code shipped to readers. Do not offer arbitrary user-supplied build patterns or run untrusted repositories without process limits.
- `sprintf-js` → `argparse` / nested `js-yaml` / `gray-matter`: precision-format DoS; registry latest sprintf-js remains 1.1.3. The frontmatter transformer explicitly uses the project's js-yaml 4 JSON_SCHEMA parser rather than gray-matter's old default parser. This reduces reachability but does not remove the installed dependency warning.

These are package/advisory counts, not eight demonstrated website exploits. No unsupported major parser replacement or old-library downgrade was made just to hide audit output. This project is **not** advertised as zero-vulnerability or safe to build arbitrary attacker-controlled projects. Upstream fixes or separately tested replacements remain follow-up work.

Run `npm audit --omit=dev` again before a release: advisories and upstream versions change. Do not confuse these Node dependency findings with database admission controls or live OAuth configuration.
