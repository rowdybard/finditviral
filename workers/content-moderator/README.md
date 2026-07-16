# FindItViral content moderator Worker

This isolated scheduled Worker polls at most 25 recent pending text submissions every two minutes. It sends only the contribution text to OpenAI's `omni-moderation-latest` model. Clean bounties, leads, and lead-confirmation sightings are automatically approved; flagged content remains pending and sends an owner-only alert.

The Worker never logs text, contributor identifiers, media paths, or credentials. Images are not sent to OpenAI.

## Required setup

1. Apply the Supabase migration before deployment.
2. Verify `finditviral.com` is onboarded for Cloudflare Email Sending and retain the restricted `digest@finditviral.com` sender/destination binding.
3. Set Worker-scoped secrets interactively; never put values on a command line:

   ```powershell
   npx wrangler secret put SUPABASE_SECRET_KEY --config workers/content-moderator/wrangler.jsonc
   npx wrangler secret put OPENAI_API_KEY --config workers/content-moderator/wrangler.jsonc
   ```

4. Validate then deploy:

   ```powershell
   npx wrangler types workers/content-moderator/worker-configuration.d.ts --config workers/content-moderator/wrangler.jsonc --env-file workers/content-moderator/.dev.vars.example
   npx tsc --noEmit -p workers/content-moderator/tsconfig.json
   npx vitest run --root workers/content-moderator
   npx wrangler deploy --dry-run --config workers/content-moderator/wrangler.jsonc
   npx wrangler deploy --config workers/content-moderator/wrangler.jsonc
   ```
