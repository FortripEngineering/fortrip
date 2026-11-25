import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { type Lang, localize, UI } from "@/lib/i18n";

export function baseOptions(lang: Lang): BaseLayoutProps {
  const t = UI[lang];
  return {
    nav: {
      title: (
        // The logo is black (currentColor in an <img>), so dark mode inverts it.
        <img src="/fortrip-logo.svg" alt="Fortrip" width={152} height={16} className="h-4 w-auto dark:invert" />
      ),
      url: localize(lang, "/"),
    },
    // Both sit above each page's table of contents instead (`PageControls`).
    slots: { languageSelect: false, themeSwitch: false },
    links: [
      { text: t.forAgents, url: "https://fortrip.ai/agents", external: true },
      { type: "button", text: t.quickstart, url: localize(lang, "/quickstart") },
    ],
  };
}
