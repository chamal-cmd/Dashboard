import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal config for the first deploy checkpoint — no R2 incremental cache
// or image optimization binding yet, since most routes here are
// force-dynamic (auth-gated) rather than ISR/ANY cached content.
export default defineCloudflareConfig({});
