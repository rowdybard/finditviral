# FindItViral retirement

FindItViral has closed. The public site provides a closure message and a domain
purchase link to `mailto:contact@finditviral.com?subject=Purchase%20finditviral.com`.

The Pages deployment contains only static HTML and a catch-all redirect file;
it includes no Pages Worker or application bundle. Both purchase links are
wrapped in Cloudflare's `email_off` comments so they work without a decode
script. Web Analytics was disabled for the domain and Pages project. Existing
Cloudflare security protections remain in place.

## Production retirement record — October 2, 2026

The Cloudflare production settings for all three workers were updated and
verified in the dashboard:

- All cron schedules are empty.
- The trend engine's three queue consumers were detached.
- Production `workers.dev` URLs and preview URLs are disabled.
- No custom domains or zone routes point to these workers.
- No email routing rules trigger the moderator or digest worker.

The existing Supabase project was already `INACTIVE`, as verified through the
connected Supabase MCP service. Cloudflare settings were changed without deleting
the workers, queues, D1 database, or Supabase database.

The deployed worker code was left unchanged. Its public entry points and
scheduled/queue triggers are disabled, so it cannot continue running through
those paths. The repository contains no service bindings or Durable Objects,
and the moderator/digest dashboards show no worker dependencies or such
bindings. `workers/retired.ts` is defensive source for future deployments; it
was checked with Wrangler dry runs but was not deployed as part of these
dashboard settings changes.

Screenshots in the task's output folder record the disabled trigger and URL
settings for the moderator and digest workers. The public Pages closure page is
deployed separately from the background-service settings.

## Disabled background services

The three service configurations now use `workers/retired.ts` as the entry point
for any future deployment:

| Service | Former work | Former cron triggers |
| --- | --- | --- |
| `finditviral-trend-engine` | Product discovery, OpenAI research, scoring and catalog patch preparation | `*/5 * * * *`, `8 * * * *`, `17 */4 * * *` |
| `finditviral-interest-digest` | Interest digest email and orphan photo cleanup | `0 * * * *` |
| `finditviral-content-moderator` | OpenAI content moderation and email | `*/2 * * * *` |

Each retired configuration has an empty cron list, disables `workers.dev` and
preview URLs, and has no database, queue, email, or secret-dependent bindings.
The shared handler returns HTTP `410 Gone` with a closure message and purchase
contact. Its scheduled handler performs no work. Its queue handler only
acknowledges unexpected late deliveries; it does not fetch, send email, use AI,
or read or write any database.

The original service source, migrations, and tests are preserved for reference.
They are not the production entry points. Changing `AUTOPILOT_MODE` to `shadow`
would not have stopped research, queue processing, email, or cleanup; the retired
entry point disables those operations directly.

## Cloudflare queue and storage inventory

The retired trend engine previously consumed these queues:

- `finditviral-trend-source-polls`
- `finditviral-trend-research`
- `finditviral-trend-research-dlq`

It also produced source-poll and research messages. The source-poll dead-letter
queue is `finditviral-trend-source-polls-dlq`. Remove the worker consumers from
the three consumed queues during retirement; preserve the queues and their data
unless a separate data-deletion decision is made. Clear all three workers' cron
triggers and disable their public subdomains and preview URLs in Cloudflare.

The preserved D1 database is `finditviral-trend-engine`, ID
`0467a04f-78f9-4ad1-a227-2997689ff822`. The existing Supabase project reference is
`hsrfyiazliydrpgtwwul`. Neither database is deleted by these configurations.
The former email sender was `digest@finditviral.com`, with delivery to
`owner@finditviral.com`; retired services have no email binding.

## Deployment and verification

Deploy each retired service with its existing Wrangler configuration. A source
change or `--dry-run` does not confirm production retirement. After deploying,
check all three services in Cloudflare for empty schedules, no queue consumers,
and disabled public subdomains/preview URLs. Existing custom-domain routes, if
present outside these files, must also be removed or disabled.

Wrangler does not remove existing queue consumers simply because they are absent
from the configuration. If a service is restored and later retired again, detach
its consumers explicitly through the dashboard or the verified CLI syntax:

```sh
npx wrangler queues consumer remove finditviral-trend-source-polls finditviral-trend-engine
npx wrangler queues consumer remove finditviral-trend-research finditviral-trend-engine
npx wrangler queues consumer remove finditviral-trend-research-dlq finditviral-trend-engine
```

The public closure page continues to run on Cloudflare Pages so visitors can
read the graceful message and contact the domain owner. The original application
API must remain unavailable through the public site and the Pages origin.
