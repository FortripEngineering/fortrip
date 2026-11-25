import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async rewrites() {
    // Each page's Markdown at its own URL plus `.md` (the root's is `/index.md`).
    return [{ source: "/:path*.md", destination: "/llms.md/:path*" }];
  },
};

const withMDX = createMDX();

export default withMDX(config);
