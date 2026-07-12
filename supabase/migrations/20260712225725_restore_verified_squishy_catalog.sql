alter table public.products drop constraint if exists products_availability_status_check;
alter table public.products add constraint products_availability_status_check
  check (availability_status in ('available', 'backorder', 'preorder', 'announced', 'limited', 'retired'));

insert into public.trends (name, slug, description, is_active) values
  ('NeeDoh', 'needoh', 'Schylling sensory and fidget products verified against the official NeeDoh catalog.', true),
  ('Sunny Days Squeeezy', 'sunny-days-squeezy', 'Sunny Days food-shaped Squeeezy toys with current first-party Target listings.', true),
  ('Mystery Squishy Dumpling', 'mystery-squishy-dumpling', 'RMS USA Original Viral Mystery Dumpling products with manufacturer-confirmed releases.', true),
  ('Taba Squishy', 'taba-squishy', 'Named TABASQUISHY products available from the brand store; generic marketplace variants are excluded.', true),
  ('Magic Jellykins', 'magic-jellykins', 'Spin Master Magic Jellykins reveal plush products with verified major-retailer listings.', true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = true;

with catalog(trend_slug, name, slug, availability_status, source_url, retailer, release_date) as (values
  ('needoh', 'NeeDoh Nice Cube', 'needoh-nice-cube', 'available', 'https://schylling.com/product/needoh-nice-cube/', 'Schylling', null::date),
  ('needoh', 'NeeDoh Jelly Squish', 'needoh-jelly-squish', 'available', 'https://schylling.com/product/needoh-jelly-squish/', 'Schylling', null::date),
  ('needoh', 'NeeDoh Squeezza', 'needoh-squeezza', 'available', 'https://schylling.com/product/needoh-squeezza/', 'Schylling', null::date),
  ('needoh', 'NeeDoh Press-Doh', 'needoh-press-doh', 'available', 'https://schylling.com/product/needoh-press-doh/', 'Schylling', null::date),
  ('needoh', 'NeeDoh Mello Mallo', 'needoh-mello-mallo', 'available', 'https://schylling.com/product/needoh-mello-mallo/', 'Schylling', null::date),
  ('needoh', 'NeeDoh Good Vibes Only', 'needoh-good-vibes', 'available', 'https://schylling.com/product/needoh-good-vibes-only/', 'Schylling', null::date),
  ('needoh', 'NeeDoh Bunnies & Chicks Assortment', 'needoh-bunnies-chicks', 'available', 'https://schylling.com/product/needoh-bunnies-chicks-assortment/', 'Schylling', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Butter Shape Fidget Toy', 'squeezy-butter-shape', 'available', 'https://www.target.com/p/-/A-94757100', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Banana', 'squeezy-banana', 'available', 'https://www.target.com/p/-/A-94757067', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Cheese Block', 'squeezy-cheese-block', 'available', 'https://www.target.com/p/-/A-1003785284', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Strawberry', 'squeezy-strawberry', 'available', 'https://www.target.com/p/-/A-94757072', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Carrot', 'squeezy-carrot', 'available', 'https://www.target.com/p/-/A-94843132', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Peach', 'squeezy-peach', 'available', 'https://www.target.com/p/-/A-94843134', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Pickle', 'squeezy-pickle', 'available', 'https://www.target.com/p/-/A-94757101', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeezy Corn on the Cob Fidget Toy', 'sunny-days-squeezy-corn-on-the-cob', 'available', 'https://www.target.com/p/-/A-94922027', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeeezy Hot Dog Fidget Toy', 'sunny-days-squeezy-hot-dog', 'available', 'https://www.target.com/p/-/A-94922028', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeeezy Fried Chicken Leg Fidget Toy', 'sunny-days-squeezy-fried-chicken-leg', 'available', 'https://www.target.com/p/-/A-94922034', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Squeeezy Pineapple Fidget Toy', 'sunny-days-squeezy-pineapple', 'available', 'https://www.target.com/p/-/A-94922037', 'Target', null::date),
  ('sunny-days-squeezy', 'Sunny Days Jumbo Squeezy Duck – Yellow', 'sunny-days-jumbo-squeezy-duck-yellow', 'available', 'https://www.target.com/p/-/A-94757068', 'Target', null::date),
  ('mystery-squishy-dumpling', 'Golden Ticket Mystery Dumpling', 'dumpling-golden-ticket-edition', 'limited', 'https://www.rms-usa.com/press/golden-ticket-mystery-dumpling', 'Five Below', date '2026-05-16'),
  ('taba-squishy', 'Tie-dye Rainbow Dumpling', 'tie-dye-rainbow-dumpling-taba-squishy', 'available', 'https://tabasquishy.com/products/tie-dye-rainbow-dumpling', 'TABASQUISHY', null::date),
  ('taba-squishy', 'Mystery Dumpling Squishy 6-Pack Display Box', 'taba-mystery-dumpling-squishy-display-box', 'available', 'https://tabasquishy.com/products/mystery-dumpling-squishy-6-pack-display-box-full-case-edition-single-box-available', 'TABASQUISHY', null::date),
  ('magic-jellykins', 'Magic Jellykins Surprise Plush Blind Box', 'magic-jellykins-surprise-plush-single', 'available', 'https://www.target.com/p/-/A-94824400', 'Target', null::date)
)
insert into public.products (
  trend_id, name, slug, availability_status, source_url, retailer,
  release_date, verified_at, is_active
)
select t.id, c.name, c.slug, c.availability_status, c.source_url, c.retailer,
       c.release_date, timestamptz '2026-07-12 00:00:00-04', true
from catalog c
join public.trends t on t.slug = c.trend_slug
on conflict (slug) do update set
  trend_id = excluded.trend_id,
  name = excluded.name,
  availability_status = excluded.availability_status,
  source_url = excluded.source_url,
  retailer = excluded.retailer,
  release_date = excluded.release_date,
  verified_at = excluded.verified_at,
  is_active = true;

do $$
begin
  if (select count(*) from public.products where is_active) <> 48 then
    raise exception 'Expected 48 active verified products after restoring squishies';
  end if;
  if (select count(*) from public.products p join public.trends t on t.id=p.trend_id where p.is_active and t.slug in ('needoh','sunny-days-squeezy','mystery-squishy-dumpling','taba-squishy','magic-jellykins')) <> 23 then
    raise exception 'Expected 23 verified active squishy products';
  end if;
end
$$;
