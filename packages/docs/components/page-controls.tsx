"use client";
import { LanguageSelect, LanguageSelectText } from "fumadocs-ui/layouts/shared/slots/language-select";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";

import { ChevronDownIcon, LanguagesIcon } from "@/components/icons";

/** The language and the theme, in one row: above the table of contents, or
 *  at the top of a page that shows none. */
export function PageControls({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-end gap-2 ${className}`}>
      <LanguageSelect variant="secondary" className="h-8 gap-1.5 px-2.5 text-sm text-fd-muted-foreground [&_svg]:size-4">
        <LanguagesIcon />
        <LanguageSelectText />
        <ChevronDownIcon className="size-3.5!" />
      </LanguageSelect>
      <ThemeSwitch className="h-8" />
    </div>
  );
}
