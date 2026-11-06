import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        // The logo is black (currentColor in an <img>), so dark mode inverts it.
        <img src="/fortrip-logo.svg" alt="Fortrip" width={152} height={16} className="h-4 w-auto dark:invert" />
      ),
      url: "/",
    },
    links: [
      { text: "Fortrip for agents", url: "https://fortrip.ai/agents", external: true },
      { type: "button", text: "Quickstart", url: "/quickstart" },
    ],
  };
}
