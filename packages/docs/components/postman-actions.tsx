"use client";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";

import { CheckIcon, DownloadIcon, LinkIcon, PostmanIcon } from "@/components/icons";
import { MENU_ITEM, TRIGGER } from "@/components/page-menus";
import type { UIText } from "@/lib/i18n";

/** The API's Postman collection: download it, or copy its URL for Postman's
 *  Import, which then follows the docs as they change. */
export function PostmanActions({ t, path, url, filename }: { t: UIText; path: string; url: string; filename: string }) {
  const [checked, copy] = useCopyButton(() => navigator.clipboard.writeText(url));
  return (
    <Popover>
      <PopoverTrigger className={TRIGGER}>
        <PostmanIcon />
        Postman
      </PopoverTrigger>
      <PopoverContent className="flex max-w-72 flex-col">
        <a href={path} download={filename} className={MENU_ITEM}>
          <DownloadIcon />
          {t.downloadCollection}
        </a>
        <button type="button" onClick={copy} className={MENU_ITEM}>
          {checked ? <CheckIcon /> : <LinkIcon />}
          {checked ? t.copiedLink : t.copyPostmanLink}
        </button>
        <p className="px-2 pt-1 pb-2 text-xs text-fd-muted-foreground">
          {t.postmanHint}
        </p>
      </PopoverContent>
    </Popover>
  );
}
