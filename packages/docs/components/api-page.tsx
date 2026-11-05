"use client";
import { createOpenAPIPage } from "fumadocs-openapi/ui";

/** An API reference page. No playground: every request needs a user's OAuth token. */
export const OpenAPIPage = createOpenAPIPage({ playground: { enabled: false } });
