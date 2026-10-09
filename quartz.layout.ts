import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"
import { isFeatureEnabled } from "./site.features"

const explorerFilter = isFeatureEnabled("reservations")
  ? (node: { slug: string; slugSegment: string }) =>
      node.slugSegment !== "tags" && node.slug !== "Fig/index" && !node.slug.startsWith("Fig/")
  : (node: { slug: string; slugSegment: string }) =>
      node.slugSegment !== "tags" &&
      node.slug !== "calendar" &&
      node.slug !== "Fig/index" &&
      !node.slug.startsWith("Fig/")

const sharedHeaderComponents = [isFeatureEnabled("auth") ? Component.Auth() : undefined].filter(
  Boolean,
) as SharedLayout["header"]

const sharedAfterBodyComponents = [
  isFeatureEnabled("reservations")
    ? Component.ConditionalRender({
        component: Component.ReservationCalendar(),
        condition: (page) => page.fileData.slug === "calendar",
      })
    : undefined,
  isFeatureEnabled("comments")
    ? Component.ConditionalRender({
        component: Component.SupaComments(),
        condition: (page) => page.fileData.slug !== "calendar",
      })
    : undefined,
].filter(Boolean) as SharedLayout["afterBody"]

const contentRightComponents = [
  isFeatureEnabled("annotations") ? Component.Annotation() : undefined,
  Component.DesktopOnly(Component.TableOfContents()),
  Component.Backlinks(),
].filter(Boolean) as PageLayout["right"]

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [...sharedHeaderComponents, Component.HomepageSlots()],
  afterBody: sharedAfterBodyComponents,
  footer: Component.Footer({
    links: {
      Quartz: "https://github.com/jackyzha0/quartz",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ConditionalRender({
      component: Component.ArticleTitle(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ConditionalRender({
      component: Component.ContentMeta(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ConditionalRender({
      component: Component.TagList(),
      condition: (page) => page.fileData.slug !== "index",
    }),
  ],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
        { Component: Component.ThemeSwitcher() },
      ],
    }),
    Component.Explorer({ folderClickBehavior: "collapse", filterFn: explorerFilter }),
  ],
  right: contentRightComponents,
}

// components for pages that display lists of pages  (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        {
          Component: Component.Search(),
          grow: true,
        },
        { Component: Component.Darkmode() },
        { Component: Component.ThemeSwitcher() },
      ],
    }),
    Component.Explorer({ folderClickBehavior: "collapse", filterFn: explorerFilter }),
  ],
  right: [],
}
