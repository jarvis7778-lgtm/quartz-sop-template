# 模板更新与展示站同步

当前稳定版本的功能范围以 GitHub Release 为准。此文档中的工作流已实现；站内管理按钮和自动数据库迁移不在第一版范围内。

## 第一版的体验与边界

更新入口是 GitHub 仓库 **Actions → Check template updates → Run workflow**。工作流每周也会检查一次。发现官方稳定 Release 后，检查通过会出现标题为 `Template update available: vX.Y.Z` 的 PR；GitHub 通知就是这一版的更新提示。用户查看变更后点击合并，现有部署流程负责发布。**暂时没有站内管理按钮、自动合并或托管预览 URL。**

文章作者不需要手工搬组件，但 GitHub 首次设置仍需要维护者协助。不要在公开页面放写仓库令牌。

## 初次启用

- 仓库必须具有 Actions 权限，且在 Settings → Actions → General 中允许工作流创建 PR。组织策略可能禁止此项，禁止时必须管理员处理，不自动索要个人令牌绕过。
- 从包含更新锁的新模板创建仓库时，保留 `.template/core-lock.json`。
- 旧仓库不能把本地文件随便标成最新。必须找出原模板版本，用 `core-update init` 对照可信原版初始化；有核心定制时先人工迁移到扩展目录，不能强行覆盖。
- 定时任务仅在默认分支生效，fork 的定时任务可能默认关闭，长期无活动也可能暂停。可手动运行。
- 使用 GitHub Pages 时启用项目原有 `ENABLE_GITHUB_PAGES` 和域名配置。其他托管平台沿用自身部署流程，不能保证所有平台都自动创建预览。

## 文件边界

更新核心采用固定路径清单和文件 SHA-256 基线，不直接覆盖整个仓库。核心包括 Quartz 引擎/组件、主题、依赖清单及必要构建/更新脚本。文章 `content/`、`site.*`、`quartz.config.ts`、`quartz.layout.ts`、`quartz/styles/custom.scss`、`quartz/static/`、独立 `site-components/`、环境文件、数据库迁移和用户工作流不被核心更新器覆盖。

`package.json` 属于核心；自定义部署命令放独立脚本，通过托管平台命令调用，例如 `node scripts/build-sites.mjs`，不要改核心包脚本。如果必须定制依赖或核心代码，自动更新会报告冲突，应人工合并。

共享组件不要直接复制进 Quartz 核心后继续各自改。展示站特有组件放 `site-components/`，通过配置里的 `ContentPage({pageBody: ...})` 和 layout 接入，展示内容继续放 `content/`。

## 检查和失败处理

工作流在无写仓库凭据的 job 中拉取官方稳定标签、解析真实 commit、检查本地核心是否被修改、准备更新，运行类型检查、更新器测试和实际静态构建。成功后才把 patch 交给另一个有写权限的 job 创建 PR，不执行 SQL，不自动合并。

- 核心冲突、无基线、构建失败：无发布，查看 Actions 错误。不要用 snapshot 把冲突伪装成干净版本。
- 相同版本的分支已存在：不强推、不覆盖用户在 PR 上的修改。继续处理已有 PR；若曾关闭 PR，可手动重新打开。
- GitHub Token 创建的 PR 不会自动触发普通 PR workflow，所以更新工作流本身承担候选检查。PR body 会明确说明这点。
- 上游新版本如果要求配置变更/数据库迁移：阅读 Release notes，另行备份、审批和执行；本更新器不承诺自动迁移。
- 更新器不修改部署流程。GitHub Pages 原有流程先 build 再 upload/deploy，构建失败不会替换旧站。其他平台需自己确认该行为。

## 回退

更新 PR 保留旧代码和旧锁的 Git 历史，合并出问题时在 GitHub Revert 此 PR，再执行部署。此操作只能回退代码，不能撤回已经发生的数据库迁移或追回已下载内容。不要删用户文章来排错。

## 模板维护者发布流程

1. 在修复分支通过模板回归，并让展示站使用同一候选核心做构建/浏览器验收。
2. 确定稳定版本 `vX.Y.Z`，在发布 commit 前生成 `.template/core-lock.json`（hash 基线不含锁自身）。发布基线内 source commit 可记录候选来源；下游应用时记录远端 tag 解引用得到的真实发布 commit，不能用标签字符串冒充 commit。
3. 检查核心清单和用户配置/API兼容性，把必须的数据库和工作流手动变更写进 Release notes。
4. 提交、打不可移动的 tag、发布非 draft / 非 prerelease 的 GitHub Release。没有 Release 时，用户检查应明确返回“无新版”，不能伪造已发布版本。
5. 展示站也通过更新 PR 接入同一 Release。若候选构建失败则不发布 Release。

发布必须经过远端 CI 和展示站验收；本工作流不替维护者自动发布 Release，也不会执行数据库迁移。
