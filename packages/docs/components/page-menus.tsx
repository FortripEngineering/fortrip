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

export const TRIGGER = buttonVariants({
  variant: "secondary",
  size: "sm",
  className: "gap-2 [&_svg]:size-3.5 data-[state=open]:bg-fd-accent data-[state=open]:text-fd-accent-foreground",
});

export const MENU_ITEM =
  "text-sm p-2 rounded-lg inline-flex items-center gap-2 text-start hover:text-fd-accent-foreground hover:bg-fd-accent [&_svg]:size-4";

const cache = new Map<string, string>();

/** Fumadocs' Markdown copy button with the site's icons: the Markdown is
 *  fetched inside the clipboard write, so Safari keeps the user's gesture. */
export function CopyMarkdownButton({ markdownUrl }: { markdownUrl: string }) {
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
      {checked ? "Copied Markdown" : "Copy Markdown"}
    </button>
  );
}

/** Where to open the page: its source on GitHub, its Markdown, or an AI chat
 *  asked to read `pageUrl`. */
export function OpenMenu({ markdownUrl, githubUrl, pageUrl }: { markdownUrl: string; githubUrl?: string; pageUrl: string }) {
  const q = `Read ${pageUrl}, I want to ask questions about it.`;
  const items = [
    ...(githubUrl ? [{ title: "Open in GitHub", href: githubUrl, Icon: GitHubIcon }] : []),
    { title: "View as Markdown", href: markdownUrl, Icon: MarkdownIcon },
    { title: "Open in Scira AI", href: `https://scira.ai/?${new URLSearchParams({ q })}`, Icon: SciraIcon },
    { title: "Open in ChatGPT", href: `https://chatgpt.com/?${new URLSearchParams({ prompt: q, hints: "search" })}`, Icon: ChatGPTIcon },
    { title: "Open in Claude", href: `https://claude.ai/new?${new URLSearchParams({ q })}`, Icon: ClaudeIcon },
    { title: "Open in Cursor", href: `https://cursor.com/link/prompt?${new URLSearchParams({ text: q })}`, Icon: CursorIcon },
  ];
  return (
    <Popover>
      <PopoverTrigger className={TRIGGER}>
        Open
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col">
        {items.map(({ title, href, Icon }) => (
          <a key={href} href={href} rel="noreferrer noopener" target="_blank" className={MENU_ITEM}>
            <Icon />
            {title}
            <ExternalLinkIcon className="ms-auto size-3.5! opacity-70" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
