-- Replace the speculative launch catalog with source-backed products while
-- preserving historical product IDs and foreign-key references.

alter table public.products
  add column if not exists availability_status text not null default 'retired',
  add column if not exists source_url text,
  add column if not exists retailer text,
  add column if not exists release_date date,
  add column if not exists verified_at timestamptz,
  add column if not exists is_active boolean not null default false;

-- Nothing is deleted: old links and any future references remain valid.
update public.products
set is_active = false, availability_status = 'retired';

alter table public.products drop constraint if exists products_availability_status_check;
alter table public.products add constraint products_availability_status_check
  check (availability_status in ('available', 'backorder', 'preorder', 'announced', 'retired'));
alter table public.products drop constraint if exists products_source_url_check;
alter table public.products add constraint products_source_url_check
  check (source_url is null or source_url ~ '^https://');
alter table public.products drop constraint if exists products_active_verification_check;
alter table public.products add constraint products_active_verification_check
  check (
    not is_active or (
      availability_status <> 'retired'
      and source_url is not null
      and verified_at is not null
    )
  );

update public.trends set is_active = false;

insert into public.trends (name, slug, description, is_active) values
  ('Dubai Chocolate', 'dubai-chocolate', 'Pistachio-and-knafeh chocolate products with current official US retail listings.', true),
  ('LEGO Collectibles', 'lego-collectibles', 'Large-format LEGO display and collector sets with verified official availability.', true),
  ('Pokémon TCG: Pitch Black', 'pokemon-tcg-pitch-black', 'High-demand Pokémon Trading Card Game products with an announced July 2026 release.', true),
  ('Splatoon Raiders amiibo', 'splatoon-raiders-amiibo', 'Nintendo Splatoon Raiders amiibo with announced July 2026 release dates.', true),
  ('Viral Beauty', 'viral-beauty', 'Limited-edition and trending beauty products listed by an official national retailer.', true),
  ('LEGO Pokémon 2026', 'lego-pokemon-2026', 'Officially announced LEGO Pokémon sets available for preorder or scheduled release.', true),
  ('LEGO ONE PIECE Season 2', 'lego-one-piece-season-2', 'Officially announced LEGO ONE PIECE Season 2 sets available for preorder.', true),
  ('Starbucks Limited Releases', 'starbucks-limited-releases', 'Officially announced limited-time Starbucks menu releases.', true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active;

with catalog(trend_slug, name, slug, availability_status, source_url, retailer, release_date) as (values
  ('dubai-chocolate', 'GHIRARDELLI Dubai Style Chocolate, 4 oz', 'ghirardelli-dubai-style-chocolate-4oz', 'available', 'https://www.target.com/p/-/A-94891844', 'Target', null::date),
  ('dubai-chocolate', 'MUDDY BITES Dubai Chocolate Waffle Cone Snacks, 4.25 oz', 'muddy-bites-dubai-chocolate-waffle-cones-4-25oz', 'available', 'https://www.target.com/p/-/A-94999182', 'Target', null::date),
  ('dubai-chocolate', 'Rolling Pin Dubai Chocolates, 3.53 oz', 'rolling-pin-dubai-chocolates-3-53oz', 'available', 'https://www.target.com/p/-/A-94802560', 'Target', null::date),
  ('lego-collectibles', 'LEGO Icons Arcade Pinball Machine (11374)', 'lego-icons-arcade-pinball-machine-11374', 'available', 'https://www.lego.com/en-us/product/arcade-pinball-machine-11374', 'LEGO', null::date),
  ('lego-collectibles', 'LEGO Star Wars Imperial Lambda-Class Shuttle (75459)', 'lego-star-wars-imperial-lambda-class-shuttle-75459', 'backorder', 'https://www.lego.com/en-us/product/imperial-lambda-class-shuttle-75459', 'LEGO', null::date),
  ('pokemon-tcg-pitch-black', 'Pokémon TCG Mega Evolution—Pitch Black Booster Bundle', 'pokemon-tcg-pitch-black-booster-bundle', 'announced', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-pitch-black-booster-bundle/JJG2TL8JVY/sku/6678359', 'Best Buy', date '2026-07-17'),
  ('pokemon-tcg-pitch-black', 'Pokémon TCG Mega Evolution—Pitch Black Elite Trainer Box', 'pokemon-tcg-pitch-black-elite-trainer-box', 'announced', 'https://www.bestbuy.com/site/searchpage.jsp?browsedCategory=pcmcat748302046148&id=pcat17071&qp=upcomingnew_facet%3DUpcoming+and+New~Coming+Soon&st=categoryid%24pcmcat748302046148', 'Best Buy', date '2026-07-17'),
  ('pokemon-tcg-pitch-black', 'Pokémon TCG Mega Evolution—Pitch Black Sleeved Booster', 'pokemon-tcg-pitch-black-sleeved-booster', 'announced', 'https://www.bestbuy.com/site/searchpage.jsp?id=pcat17071&st=pitch+black', 'Best Buy', date '2026-07-17'),
  ('splatoon-raiders-amiibo', 'Nintendo amiibo Big Man (Splatoon Raiders)', 'nintendo-amiibo-big-man-splatoon-raiders', 'announced', 'https://www.bestbuy.com/site/searchpage.jsp?browsedCategory=pcmcat748302046148&id=pcat17071&qp=upcomingnew_facet%3DUpcoming+and+New~Coming+Soon&st=categoryid%24pcmcat748302046148', 'Best Buy', date '2026-07-23'),
  ('splatoon-raiders-amiibo', 'Nintendo amiibo Frye (Splatoon Raiders)', 'nintendo-amiibo-frye-splatoon-raiders', 'announced', 'https://www.bestbuy.com/site/searchpage.jsp?browsedCategory=pcmcat748302046148&id=pcat17071&qp=upcomingnew_facet%3DUpcoming+and+New~Coming+Soon&st=categoryid%24pcmcat748302046148', 'Best Buy', date '2026-07-23'),
  ('splatoon-raiders-amiibo', 'Nintendo amiibo Shiver (Splatoon Raiders)', 'nintendo-amiibo-shiver-splatoon-raiders', 'announced', 'https://www.bestbuy.com/site/searchpage.jsp?browsedCategory=pcmcat748302046148&id=pcat17071&qp=upcomingnew_facet%3DUpcoming+and+New~Coming+Soon&st=categoryid%24pcmcat748302046148', 'Best Buy', date '2026-07-23'),
  ('viral-beauty', 'Sol de Janeiro Limited Edition Body Badalada Daily Glow Lotion', 'sol-de-janeiro-body-badalada-daily-glow-lotion', 'available', 'https://www.ulta.com/discover/lifestyle/trending-makeup-and-beauty-products', 'Ulta Beauty', null::date),
  ('viral-beauty', 'Morphe Cheek Thrills Bronze & Tone Duo', 'morphe-cheek-thrills-bronze-tone-duo', 'available', 'https://www.ulta.com/discover/lifestyle/trending-makeup-and-beauty-products', 'Ulta Beauty', null::date),
  ('lego-pokemon-2026', 'LEGO Pokémon Munchlax (72150)', 'lego-pokemon-munchlax-72150', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/july/lego-pokemon-product-announcement-summer-2026', 'LEGO', date '2026-08-01'),
  ('lego-pokemon-2026', 'LEGO Pokémon Arcanine (72160)', 'lego-pokemon-arcanine-72160', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/july/lego-pokemon-product-announcement-summer-2026', 'LEGO', date '2026-08-01'),
  ('lego-pokemon-2026', 'LEGO Pokémon Rayquaza (72168)', 'lego-pokemon-rayquaza-72168', 'announced', 'https://www.lego.com/en-us/aboutus/news/2026/july/lego-pokemon-product-announcement-summer-2026', 'LEGO', date '2026-08-01'),
  ('lego-pokemon-2026', 'LEGO Pokémon Iconic Trainer Moments Poké Ball (72154)', 'lego-pokemon-iconic-trainer-moments-poke-ball-72154', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/july/lego-pokemon-product-announcement-summer-2026', 'LEGO', date '2026-10-01'),
  ('lego-pokemon-2026', 'LEGO Pokémon Up-Scaled Red Minifigure (40868)', 'lego-pokemon-up-scaled-red-minifigure-40868', 'preorder', 'https://www.lego.com/en-us/product/up-scaled-red-minifigure-40868', 'LEGO', date '2026-10-01'),
  ('lego-one-piece-season-2', 'LEGO ONE PIECE Dr. Hiriluk’s Hideout (75641)', 'lego-one-piece-dr-hiriluks-hideout-75641', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/april/lego-one-piece-season-2', 'LEGO', date '2026-08-01'),
  ('lego-one-piece-season-2', 'LEGO ONE PIECE Showdown with Captain Smoker (75642)', 'lego-one-piece-showdown-captain-smoker-75642', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/april/lego-one-piece-season-2', 'LEGO', date '2026-08-01'),
  ('lego-one-piece-season-2', 'LEGO ONE PIECE Tony Tony Chopper (75643)', 'lego-one-piece-tony-tony-chopper-75643', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/april/lego-one-piece-season-2', 'LEGO', date '2026-08-01'),
  ('lego-one-piece-season-2', 'LEGO ONE PIECE Dorry vs. Brogy – Giants of Little Garden (75644)', 'lego-one-piece-dorry-vs-brogy-75644', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/april/lego-one-piece-season-2', 'LEGO', date '2026-08-01'),
  ('lego-one-piece-season-2', 'LEGO ONE PIECE Battle at Drum Castle (75645)', 'lego-one-piece-battle-at-drum-castle-75645', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/april/lego-one-piece-season-2', 'LEGO', date '2026-08-01'),
  ('lego-one-piece-season-2', 'LEGO ONE PIECE Garp’s Marine Battleship (75646)', 'lego-one-piece-garps-marine-battleship-75646', 'preorder', 'https://www.lego.com/en-us/aboutus/news/2026/april/lego-one-piece-season-2', 'LEGO', date '2026-08-01'),
  ('starbucks-limited-releases', 'Starbucks Unicorn Frappuccino 2026 Return', 'starbucks-unicorn-frappuccino-2026-return', 'announced', 'https://about.starbucks.com/press/2026/unicorn-frappuccino-blended-beverage-makes-its-magical-return-later-this-summer/', 'Starbucks', null::date)
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
  if (select count(*) from public.products where is_active) <> 25 then
    raise exception 'Expected 25 active verified products';
  end if;
  if not exists (select 1 from public.products where is_active and availability_status = 'available') then
    raise exception 'Catalog requires obtainable products';
  end if;
  if not exists (select 1 from public.products where is_active and availability_status in ('preorder', 'announced')) then
    raise exception 'Catalog requires prerelease products';
  end if;
  if exists (
    select 1 from public.products p
    join public.trends t on t.id = p.trend_id
    where p.is_active and (not t.is_active or p.source_url is null or p.verified_at is null)
  ) then
    raise exception 'Active catalog contains unverified products';
  end if;
end
$$;
