"use client";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";
import { useState } from "react";

import {
  ChatGPTIcon,
  CheckIcon,
  ChevronDownIcon,
  ClaudeIcon,
  CopyIcon,
  CursorIcon,
  ExternalLinkIcon,
  GitHubIcon,
  MarkdownIcon,
  SciraIcon,
} from "@/components/icons";
import type { UIText } from "@/lib/i18n";

export const TRIGGER = buttonVariants({
  variant: "secondary",
  size: "sm",
  // As tall and as rounded as the toolbar above the table of contents.
  className:
    "h-8 gap-2 rounded-lg bg-fd-secondary/50 px-3 text-[13px] shadow-xs [&_svg]:size-3.5 [&_svg:not([data-brand])]:text-fd-muted-foreground data-[state=open]:bg-fd-accent data-[state=open]:text-fd-accent-foreground",
});

export const MENU_ITEM =
  "text-sm p-2 rounded-lg inline-flex items-center gap-2 text-start hover:text-fd-accent-foreground hover:bg-fd-accent [&_svg]:size-4";

const cache = new Map<string, string>();

/** Fumadocs' Markdown copy button with the site's icons: the Markdown is
 *  fetched inside the clipboard write, so Safari keeps the user's gesture. */
export function CopyMarkdownButton({ t, markdownUrl }: { t: UIText; markdownUrl: string }) {
  const [loading, setLoading] = useState(false);
  const [checked, onClick] = useCopyButton(async () => {
    const cached = cache.get(markdownUrl);
    if (cached) return navigator.clipboard.writeText(cached);
    setLoading(true);
    try {
      const text = fetch(markdownUrl).then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${markdownUrl}: ${res.status}`);
        const content = await res.text();
        cache.set(markdownUrl, content);
        return content;
      });
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
    } finally {
      setLoading(false);
    }
  });
  return (
    <button type="button" disabled={loading} aria-live="polite" onClick={onClick} className={TRIGGER}>
      {checked ? <CheckIcon /> : <CopyIcon />}
      {checked ? t.copiedMarkdown : t.copyMarkdown}
    </button>
  );
}

/** Where to open the page: its source on GitHub, its Markdown, or an AI chat
 *  asked to read `pageUrl`. */
export function OpenMenu({
  t,
  markdownUrl,
  githubUrl,
  pageUrl,
}: {
  t: UIText;
  markdownUrl: string;
  githubUrl?: string;
  pageUrl: string;
}) {
  const q = t.askPrompt.replace("{url}", pageUrl);
  const items = [
    ...(githubUrl ? [{ title: t.openInGitHub, href: githubUrl, Icon: GitHubIcon }] : []),
    { title: t.viewAsMarkdown, href: markdownUrl, Icon: MarkdownIcon },
    { title: t.openInScira, href: `https://scira.ai/?${new URLSearchParams({ q })}`, Icon: SciraIcon },
    { title: t.openInChatGPT, href: `https://chatgpt.com/?${new URLSearchParams({ prompt: q, hints: "search" })}`, Icon: ChatGPTIcon },
    { title: t.openInClaude, href: `https://claude.ai/new?${new URLSearchParams({ q })}`, Icon: ClaudeIcon },
    { title: t.openInCursor, href: `https://cursor.com/link/prompt?${new URLSearchParams({ text: q })}`, Icon: CursorIcon },
  ];
  return (
    <Popover>
      <PopoverTrigger className={TRIGGER}>
        {t.open}
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col">
        {items.map(({ title, href, Icon }) => (
          <a key={href} href={href} rel="noreferrer noopener" target="_blank" className={MENU_ITEM}>
            <Icon />
            {title}
            <ExternalLinkIcon className="ms-auto size-3.5! text-fd-muted-foreground" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
