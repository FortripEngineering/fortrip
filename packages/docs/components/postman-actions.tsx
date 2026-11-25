"use client";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";

import { CheckIcon, DownloadIcon, LinkIcon, PostmanIcon } from "@/components/icons";
import { MENU_ITEM, TRIGGER } from "@/components/page-menus";

/** The API's Postman collection: download it, or copy its URL for Postman's
 *  Import, which then follows the docs as they change. */
export function PostmanActions({ path, url, filename }: { path: string; url: string; filename: string }) {
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
          Download collection
        </a>
        <button type="button" onClick={copy} className={MENU_ITEM}>
          {checked ? <CheckIcon /> : <LinkIcon />}
          {checked ? "Copied link" : "Copy link for Postman Import"}
        </button>
        <p className="px-2 pt-1 pb-2 text-xs text-fd-muted-foreground">
          In Postman, choose Import and paste the link. Set the collection's <code>token</code> variable to your API key.
        </p>
      </PopoverContent>
    </Popover>
  );
}
