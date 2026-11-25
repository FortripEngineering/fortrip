"use client";
import { LanguageSelect, LanguageSelectText } from "fumadocs-ui/layouts/shared/slots/language-select";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";

import { ChevronDownIcon, GitHubIcon, LanguagesIcon } from "@/components/icons";

/** One control: as tall, as rounded and as filled as the page action buttons. */
const BUTTON =
  "inline-flex h-8 items-center justify-center rounded-lg border bg-fd-secondary/50 text-fd-muted-foreground shadow-xs transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground [&_svg]:text-current";

/** The repository, the language and the theme, side by side: above the
 *  table of contents, or at the top of a page that shows none. */
export function PageControls({ repositoryUrl, className = "" }: { repositoryUrl: string; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <a href={repositoryUrl} target="_blank" rel="noreferrer noopener" aria-label="GitHub" title="GitHub" className={`${BUTTON} w-8`}>
        <GitHubIcon className="size-4" />
      </a>
      <LanguageSelect variant="ghost" className={`${BUTTON} gap-1.5 px-2.5 text-[13px] font-medium [&_svg]:size-3.5`}>
        <LanguagesIcon />
        <LanguageSelectText />
        <ChevronDownIcon className="opacity-60" />
      </LanguageSelect>
      <ThemeSwitch className={`${BUTTON} gap-0.5 p-0.5 hover:bg-fd-secondary/50 *:size-6.5 *:rounded-md *:p-1.5`} />
    </div>
  );
}
