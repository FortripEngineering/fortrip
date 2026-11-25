import { defineI18n } from "fumadocs-core/i18n";

/**
 * The docs' languages. English is the default and keeps its URLs
 * (`/quickstart`); Chinese is under `/zh` (`/zh/quickstart`). A page with no
 * `.zh.mdx` translation is the English page under its Chinese URL.
 */
export const i18n = defineI18n({
  defaultLanguage: "en",
  languages: ["en", "zh"],
  hideLocale: "default-locale",
  parser: "dot",
});

export type Lang = (typeof i18n.languages)[number];

export function isLang(value: string): value is Lang {
  return (i18n.languages as string[]).includes(value);
}

/** `/x` in a language: as it is in English, `/zh/x` in Chinese. */
export function localize(lang: Lang, path: string): string {
  if (lang === i18n.defaultLanguage) return path;
  return path === "/" ? `/${lang}` : `/${lang}${path}`;
}

/** A link written in a page, in the page's language: a page on the site
 *  (`/payments#flow`) is localized; a file (`/openapi.json`), another site or
 *  an anchor on the page stays as it is. */
export function localizeHref(lang: Lang, href: string | undefined): string | undefined {
  if (!href?.startsWith("/") || href.startsWith("//")) return href;
  const [, path = "", rest = ""] = /^([^#?]*)(.*)$/s.exec(href) ?? [];
  if (/\.\w+$/.test(path)) return href;
  return `${localize(lang, path)}${rest}`;
}

/** The site's own words, outside the pages' content. */
export const UI = {
  en: {
    languageName: "English",
    htmlLang: "en",
    siteDescription: "Connect an AI agent to Fortrip to search, price and book hotels.",
    forAgents: "Fortrip for agents",
    quickstart: "Quickstart",
    copyMarkdown: "Copy Markdown",
    copiedMarkdown: "Copied Markdown",
    open: "Open",
    openInGitHub: "Open in GitHub",
    viewAsMarkdown: "View as Markdown",
    openInScira: "Open in Scira AI",
    openInChatGPT: "Open in ChatGPT",
    openInClaude: "Open in Claude",
    openInCursor: "Open in Cursor",
    askPrompt: "Read {url}, I want to ask questions about it.",
    downloadCollection: "Download collection",
    copyPostmanLink: "Copy link for Postman Import",
    copiedLink: "Copied link",
    postmanHint: "In Postman, choose Import and paste the link. Set the collection's token variable to your API key.",
    terms: "Terms",
    privacy: "Privacy",
    bookingConditions: "Booking conditions",
    support: "Support",
    untranslated: "",
  },
  zh: {
    languageName: "简体中文",
    htmlLang: "zh-CN",
    siteDescription: "把 AI 智能体接入 Fortrip，搜索、比价并预订酒店。",
    forAgents: "Fortrip 智能体",
    quickstart: "快速开始",
    copyMarkdown: "复制 Markdown",
    copiedMarkdown: "已复制 Markdown",
    open: "打开",
    openInGitHub: "在 GitHub 中打开",
    viewAsMarkdown: "查看 Markdown",
    openInScira: "在 Scira AI 中打开",
    openInChatGPT: "在 ChatGPT 中打开",
    openInClaude: "在 Claude 中打开",
    openInCursor: "在 Cursor 中打开",
    askPrompt: "请阅读 {url}，我想就它提几个问题。",
    downloadCollection: "下载 Collection",
    copyPostmanLink: "复制链接，用于 Postman 导入",
    copiedLink: "已复制链接",
    postmanHint: "在 Postman 中选择 Import 并粘贴链接，再把 Collection 的 token 变量设为你的 API key。",
    terms: "服务条款",
    privacy: "隐私政策",
    bookingConditions: "预订条款",
    support: "支持",
    untranslated: "本页暂无中文版本，以下为英文原文。",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type UIText = (typeof UI)[Lang];

/** Fumadocs' own words (search, table of contents, pagination, …) in Chinese. */
export const FUMADOCS_ZH = {
  displayName: "简体中文",
  "Ask AI(AI chat button)": "问 AI",
  "Back to Home(404 page)": "返回首页",
  "Choose a language(language switcher)": "选择语言",
  "Choose a language(language switcher)(aria-label)": "选择语言",
  "Close Banner(banner)(aria-label)": "关闭横幅",
  "Close Search(search dialog)(aria-label)": "关闭搜索",
  "Close Sidebar(aria-label)": "关闭侧边栏",
  "Close Sidebar(sidebar)(aria-label)": "关闭侧边栏",
  "Close(image zoom)(aria-label)": "关闭",
  "Collapse Sidebar(sidebar)(aria-label)": "收起侧边栏",
  "Copied Anchor Link(heading anchor)(aria-label)": "已复制锚点链接",
  "Copied Link(accordion)(aria-label)": "已复制链接",
  "Copied Markdown(page actions)": "已复制 Markdown",
  "Copied Text(code block)(aria-label)": "已复制",
  "Copy Anchor Link(heading anchor)(aria-label)": "复制锚点链接",
  "Copy Link(accordion)(aria-label)": "复制链接",
  "Copy Markdown(page actions)": "复制 Markdown",
  "Copy Text(code block)(aria-label)": "复制",
  "Dark(theme switcher)(aria-label)": "深色",
  "Default(type table)": "默认值",
  "Edit on GitHub(edit page)": "在 GitHub 上编辑",
  "Hide Sidebar(sidebar)": "隐藏侧边栏",
  "Image Viewer(image zoom)(aria-label)": "图片查看器",
  "Last updated on(page footer)": "最后更新于",
  "Layout Tab(layout tab trigger)": "布局标签",
  "Light(theme switcher)(aria-label)": "浅色",
  "Next Image(image zoom)(aria-label)": "下一张",
  "Next Page(pagination)": "下一页",
  "No Headings(table of contents)": "没有标题",
  "No results found(search dialog)": "没有找到结果",
  "On this page(table of contents)": "本页目录",
  "Open Search(search trigger)(aria-label)": "打开搜索",
  "Open Sidebar(sidebar)(aria-label)": "打开侧边栏",
  "Open in ChatGPT(page actions)": "在 ChatGPT 中打开",
  "Open in Claude(page actions)": "在 Claude 中打开",
  "Open in Cursor(page actions)": "在 Cursor 中打开",
  "Open in GitHub(page actions)": "在 GitHub 中打开",
  "Open in Scira AI(page actions)": "在 Scira AI 中打开",
  "Open(page actions)": "打开",
  "Page Not Found(404 page)": "页面不存在",
  "Parameters(type table)": "参数",
  "Previous Image(image zoom)(aria-label)": "上一张",
  "Previous Page(pagination)": "上一页",
  "Prop(type table)": "属性",
  "Read {url}, I want to ask questions about it.(page actions)": "请阅读 {url}，我想就它提几个问题。",
  "Returns(type table)": "返回值",
  "Search failed(search dialog)": "搜索失败",
  "Search failed, showing results for {query}(search dialog)": "搜索失败，显示 {query} 的结果",
  "Search(search dialog)": "搜索",
  "Search(search trigger)": "搜索",
  "Show Sidebar(sidebar)": "显示侧边栏",
  "System(theme switcher)(aria-label)": "跟随系统",
  "Table of Contents(inline table of contents)": "目录",
  "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)":
    "你要找的页面可能已被删除、改名，或暂时无法访问。",
  "Toggle Menu(mobile menu)(aria-label)": "切换菜单",
  "Toggle Theme(theme switcher)(aria-label)": "切换主题",
  "Type(type table)": "类型",
  "View as Markdown(page actions)": "查看 Markdown",
};
