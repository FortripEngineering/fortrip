"use client";
import { LanguageSelect, LanguageSelectText } from "fumadocs-ui/layouts/shared/slots/language-select";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";

import { ChevronDownIcon, GitHubIcon, LanguagesIcon } from "@/components/icons";

const ITEM =
  "inline-flex h-7 items-center justify-center rounded-md transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground [&_svg]:text-current";

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-fd-border" />;
}

/** The repository, the language and the theme, as one toolbar: above the
 *  table of contents, or at the top of a page that shows none. */
export function PageControls({ repositoryUrl, className = "" }: { repositoryUrl: string; className?: string }) {
  return (
    <div className={`flex justify-end ${className}`}>
      <div className="inline-flex h-8 items-center rounded-lg border bg-fd-secondary/50 p-0.5 text-fd-muted-foreground shadow-xs">
        <a href={repositoryUrl} target="_blank" rel="noreferrer noopener" aria-label="GitHub" title="GitHub" className={`${ITEM} w-7`}>
          <GitHubIcon className="size-4" />
        </a>
        <Divider />
        <LanguageSelect variant="ghost" className={`${ITEM} gap-1.5 px-2 text-[13px] font-medium [&_svg]:size-3.5`}>
          <LanguagesIcon />
          <LanguageSelectText />
          <ChevronDownIcon className="opacity-60" />
        </LanguageSelect>
        <Divider />
        <ThemeSwitch className="h-7 gap-0.5 rounded-md border-0 p-0 *:size-7 *:rounded-md *:p-1.5" />
      </div>
    </div>
  );
}
