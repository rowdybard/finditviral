-- FindItViral — Seed Data
-- Run this in the Supabase SQL Editor after schema.sql and rls.sql
-- 5 trends, 97 products

-- ============================================
-- Trends
-- ============================================

insert into trends (name, slug, description, is_active) values
  ('NeeDoh', 'needoh', 'Schylling sensory fidget toys — 50+ styles of squishy, squeezy, stretchy stress balls. TikTok viral 2025-2026.', true),
  ('Mystery Squishy Dumpling', 'mystery-squishy-dumpling', 'RMS USA blind-box bao bun squishies with rarity tiers. 500M+ TikTok views. Sells out within an hour.', true),
  ('Sunny Days Squeezy', 'sunny-days-squeezy', 'Jumbo food-shaped slow-rising foam squishies at Target. Banana, butter, cheese, carrot & more.', true),
  ('Taba Squishy', 'taba-squishy', 'Handmade food-grade silicone animal squishies. Capybara, hamster, duck & more. TikTok ASMR viral.', true),
  ('Magic Jellykins', 'magic-jellykins', 'Spin Master water-activated reveal plushies. 20 food-themed animals to collect. Summer 2026 viral.', true)
on conflict (slug) do nothing;

-- ============================================
-- Products: NeeDoh (49)
-- ============================================

do $$
declare
  tid uuid;
begin
  select id into tid from trends where slug = 'needoh';

  insert into products (trend_id, name, slug) values
    (tid, 'Classic NeeDoh Groovy Glob', 'needoh-classic-groovy-glob'),
    (tid, 'NeeDoh Nice Cube', 'needoh-nice-cube'),
    (tid, 'NeeDoh Cool Cats', 'needoh-cool-cats'),
    (tid, 'NeeDoh Funky Pups', 'needoh-funky-pups'),
    (tid, 'NeeDoh Dream Drop', 'needoh-dream-drop'),
    (tid, 'NeeDoh Gummy Bear', 'needoh-gummy-bear'),
    (tid, 'Super NeeDoh', 'needoh-super-needoh'),
    (tid, 'Color Changing NeeDoh', 'needoh-color-changing'),
    (tid, 'NeeDoh Gumdrop', 'needoh-gumdrop'),
    (tid, 'NeeDoh Nice Berg', 'needoh-nice-berg'),
    (tid, 'NeeDoh Nice Cream', 'needoh-nice-cream'),
    (tid, 'NeeDoh Dig It Pig', 'needoh-dig-it-pig'),
    (tid, 'NeeDoh Good Vibes', 'needoh-good-vibes'),
    (tid, 'NeeDoh Dohnut', 'needoh-dohnut'),
    (tid, 'NeeDoh Jelly Dohnut', 'needoh-jelly-dohnut'),
    (tid, 'NeeDoh Dohnut Holes', 'needoh-dohnut-holes'),
    (tid, 'NeeDoh Squeezza', 'needoh-squeezza'),
    (tid, 'NeeDoh Peace o Cake', 'needoh-peace-o-cake'),
    (tid, 'NeeDoh Nicesicle', 'needoh-nicesicle'),
    (tid, 'NeeDoh Mello Mallo', 'needoh-mello-mallo'),
    (tid, 'NeeDoh Ramen Noodlies', 'needoh-ramen-noodlies'),
    (tid, 'NeeDoh Groovy Fruit', 'needoh-groovy-fruit'),
    (tid, 'NeeDoh Nice Cube Swirl', 'needoh-nice-cube-swirl'),
    (tid, 'NeeDoh Nice Cube Glow', 'needoh-nice-cube-glow'),
    (tid, 'NeeDoh Nice Ice Baby', 'needoh-nice-ice-baby'),
    (tid, 'NeeDoh Glitter & Glow Niceberg', 'needoh-glitter-glow-niceberg'),
    (tid, 'NeeDoh Teenie Singles', 'needoh-teenie-singles'),
    (tid, 'NeeDoh Teenie Classic 3-Pack', 'needoh-teenie-classic-3pack'),
    (tid, 'NeeDoh Teenie Cool Cats', 'needoh-teenie-cool-cats'),
    (tid, 'NeeDoh Teenie Funky Pups', 'needoh-teenie-funky-pups'),
    (tid, 'NeeDoh Hot Shot Teenie', 'needoh-hot-shot-teenie'),
    (tid, 'NeeDoh Super Cool Cats', 'needoh-super-cool-cats'),
    (tid, 'NeeDoh Jelly Squish', 'needoh-jelly-squish'),
    (tid, 'NeeDoh Bunnies & Chicks', 'needoh-bunnies-chicks'),
    (tid, 'NeeDoh Polar Glow Penguin', 'needoh-polar-glow-penguin'),
    (tid, 'NeeDoh Chicka Deedos', 'needoh-chicka-deedos'),
    (tid, 'NeeDoh Shaggy', 'needoh-shaggy'),
    (tid, 'NeeDoh Fuzz Ball Flower Power', 'needoh-fuzz-ball-flower-power'),
    (tid, 'NeeDoh Fuzz Ball Wonder Waves', 'needoh-fuzz-ball-wonder-waves'),
    (tid, 'NeeDoh Wild Cats Fuzz Ball', 'needoh-wild-cats-fuzz-ball'),
    (tid, 'NeeDoh Snowball Crunch', 'needoh-snowball-crunch'),
    (tid, 'NeeDoh SplootSplat', 'needoh-splootsplat'),
    (tid, 'NeeDoh Marbleez', 'needoh-marbleez'),
    (tid, 'NeeDoh Groovy Jewel', 'needoh-groovy-jewel'),
    (tid, 'NeeDoh Dippin Dazzler', 'needoh-dippin-dazzler'),
    (tid, 'NeeDoh Swirlie Egg', 'needoh-swirlie-egg'),
    (tid, 'NeeDoh Squeeze Hearts', 'needoh-squeeze-hearts'),
    (tid, 'NeeDoh Advent Calendar', 'needoh-advent-calendar')
  on conflict (slug) do nothing;
end $$;

-- ============================================
-- Products: Mystery Squishy Dumpling (20)
-- ============================================

do $$
declare
  tid uuid;
begin
  select id into tid from trends where slug = 'mystery-squishy-dumpling';

  insert into products (trend_id, name, slug) values
    (tid, 'Mystery Dumpling Series 1 (Original)', 'dumpling-series-1-original'),
    (tid, 'Mystery Dumpling Series 2', 'dumpling-series-2'),
    (tid, 'Mystery Dumpling Series 3 Rainbow', 'dumpling-series-3-rainbow'),
    (tid, 'MINI Mystery Dumpling Series 1', 'dumpling-mini-series-1'),
    (tid, 'MINI Mystery Dumpling Series 3', 'dumpling-mini-series-3'),
    (tid, 'Mystery Big Bao Bun 7 inch', 'dumpling-big-bao-bun-7inch'),
    (tid, 'Super Mega Jumbo Rainbow Dumpling', 'dumpling-super-mega-jumbo-rainbow'),
    (tid, 'Golden Ticket Edition Dumpling', 'dumpling-golden-ticket-edition'),
    (tid, 'Seashell Series Dumpling', 'dumpling-seashell-series'),
    (tid, 'Sunset Series Dumpling', 'dumpling-sunset-series'),
    (tid, 'Americana Edition Dumpling', 'dumpling-americana-edition'),
    (tid, 'Shark Edition Dumpling', 'dumpling-shark-edition'),
    (tid, 'Starlight Series Dumpling', 'dumpling-starlight-series'),
    (tid, 'Rose Gold Glitter Dumpling', 'dumpling-rose-gold-glitter'),
    (tid, 'Sugar Edition Dumpling', 'dumpling-sugar-edition'),
    (tid, 'Dumpling Advent Calendar', 'dumpling-advent-calendar'),
    (tid, 'Dumpling Multi-Pack 2x', 'dumpling-multipack-2x'),
    (tid, 'Dumpling Multi-Pack 4x', 'dumpling-multipack-4x'),
    (tid, 'Pink Glitter Dumpling', 'dumpling-pink-glitter'),
    (tid, 'Galaxy Glitter Dumpling', 'dumpling-galaxy-glitter')
  on conflict (slug) do nothing;
end $$;

-- ============================================
-- Products: Sunny Days Squeezy (13)
-- ============================================

do $$
declare
  tid uuid;
begin
  select id into tid from trends where slug = 'sunny-days-squeezy';

  insert into products (trend_id, name, slug) values
    (tid, 'Squeezy Banana', 'squeezy-banana'),
    (tid, 'Squeezy Butter Shape', 'squeezy-butter-shape'),
    (tid, 'Squeezy Cheese Block', 'squeezy-cheese-block'),
    (tid, 'Squeezy Carrot', 'squeezy-carrot'),
    (tid, 'Squeezy Peach', 'squeezy-peach'),
    (tid, 'Squeezy Pickle', 'squeezy-pickle'),
    (tid, 'Squeezy Strawberry', 'squeezy-strawberry'),
    (tid, 'Squeezy Grape', 'squeezy-grape'),
    (tid, 'Squeezy Cherry', 'squeezy-cherry'),
    (tid, 'Squeezy Apple', 'squeezy-apple'),
    (tid, 'Squeezy Ice Cream Sandwich', 'squeezy-ice-cream-sandwich'),
    (tid, 'Squeezy Croissant', 'squeezy-croissant'),
    (tid, 'Squeezy Americana Rubber Ducks 4pk', 'squeezy-americana-rubber-ducks-4pk')
  on conflict (slug) do nothing;
end $$;

-- ============================================
-- Products: Taba Squishy (12)
-- ============================================

do $$
declare
  tid uuid;
begin
  select id into tid from trends where slug = 'taba-squishy';

  insert into products (trend_id, name, slug) values
    (tid, 'Sleeping Capybara Taba Squishy', 'taba-sleeping-capybara'),
    (tid, 'Flocked Chick Taba Squishy', 'taba-flocked-chick'),
    (tid, 'Flocked Hamster Taba Squishy', 'taba-flocked-hamster'),
    (tid, 'Flocked White Hamster Taba Squishy', 'taba-flocked-white-hamster'),
    (tid, 'Light Yellow Bear Taba Squishy', 'taba-light-yellow-bear'),
    (tid, 'Glitter Transparent Jellyfish Taba Squishy', 'taba-glitter-transparent-jellyfish'),
    (tid, 'Taba Paw Squishy', 'taba-paw'),
    (tid, 'Flocked Duck Taba Squishy', 'taba-flocked-duck'),
    (tid, 'Cat Taba Squishy', 'taba-cat'),
    (tid, 'Turtle Taba Squishy', 'taba-turtle'),
    (tid, 'Seal Taba Squishy', 'taba-seal'),
    (tid, 'Axolotl Taba Squishy', 'taba-axolotl')
  on conflict (slug) do nothing;
end $$;

-- ============================================
-- Products: Magic Jellykins (3)
-- ============================================

do $$
declare
  tid uuid;
begin
  select id into tid from trends where slug = 'magic-jellykins';

  insert into products (trend_id, name, slug) values
    (tid, 'Magic Jellykins Surprise Plush Single', 'magic-jellykins-surprise-plush-single'),
    (tid, 'Magic Jellykins Surprise Plush Jar 2-Pack', 'magic-jellykins-surprise-plush-jar-2pack'),
    (tid, 'Magic Jellykins Doll Playset 12pk', 'magic-jellykins-doll-playset-12pk')
  on conflict (slug) do nothing;
end $$;

-- ============================================
-- Seed: Sample US Zip Codes (lat/long)
-- For production, import the full USPS dataset.
-- This sample covers major metro areas.
-- ============================================

insert into zip_codes (zip_code, latitude, longitude, city, state) values
  ('01001', 42.0675, -72.6019, 'Agawam', 'MA'),
  ('02101', 42.3601, -71.0589, 'Boston', 'MA'),
  ('02801', 41.4792, -71.3131, 'Newport', 'RI'),
  ('03301', 43.2081, -71.5376, 'Concord', 'NH'),
  ('04001', 43.6679, -70.2891, 'Portland', 'ME'),
  ('10001', 40.7484, -73.9967, 'New York', 'NY'),
  ('10002', 40.7157, -73.9893, 'New York', 'NY'),
  ('10003', 40.7282, -73.9875, 'New York', 'NY'),
  ('10011', 40.7440, -73.9995, 'New York', 'NY'),
  ('10024', 40.7970, -73.9690, 'New York', 'NY'),
  ('11201', 40.6943, -73.9903, 'Brooklyn', 'NY'),
  ('11211', 40.7127, -73.9567, 'Brooklyn', 'NY'),
  ('19101', 39.9526, -75.1652, 'Philadelphia', 'PA'),
  ('19103', 39.9570, -75.1710, 'Philadelphia', 'PA'),
  ('19147', 39.9350, -75.1500, 'Philadelphia', 'PA'),
  ('20001', 38.9121, -77.0121, 'Washington', 'DC'),
  ('20002', 38.8990, -76.9830, 'Washington', 'DC'),
  ('20009', 38.9180, -77.0360, 'Washington', 'DC'),
  ('22030', 38.8460, -77.3080, 'Fairfax', 'VA'),
  ('30301', 33.7490, -84.3880, 'Atlanta', 'GA'),
  ('30303', 33.7530, -84.3900, 'Atlanta', 'GA'),
  ('30305', 33.7940, -84.3730, 'Atlanta', 'GA'),
  ('30309', 33.7870, -84.3740, 'Atlanta', 'GA'),
  ('33101', 25.7743, -80.1937, 'Miami', 'FL'),
  ('33109', 25.7743, -80.1300, 'Miami Beach', 'FL'),
  ('33124', 25.7180, -80.2790, 'Miami', 'FL'),
  ('33139', 25.7920, -80.1300, 'Miami Beach', 'FL'),
  ('33601', 27.9506, -82.4572, 'Tampa', 'FL'),
  ('33602', 27.9506, -82.4593, 'Tampa', 'FL'),
  ('60601', 41.8855, -87.6217, 'Chicago', 'IL'),
  ('60602', 41.8789, -87.6356, 'Chicago', 'IL'),
  ('60607', 41.8750, -87.6510, 'Chicago', 'IL'),
  ('60611', 41.8945, -87.6200, 'Chicago', 'IL'),
  ('60614', 41.9100, -87.6500, 'Chicago', 'IL'),
  ('60622', 41.9010, -87.6770, 'Chicago', 'IL'),
  ('60657', 41.9390, -87.6540, 'Chicago', 'IL'),
  ('63101', 38.6270, -90.1994, 'St. Louis', 'MO'),
  ('63108', 38.6480, -90.2500, 'St. Louis', 'MO'),
  ('75201', 32.7791, -96.8037, 'Dallas', 'TX'),
  ('75204', 32.8100, -96.7800, 'Dallas', 'TX'),
  ('75219', 32.8100, -96.8200, 'Dallas', 'TX'),
  ('75230', 32.8600, -96.7900, 'Dallas', 'TX'),
  ('77001', 29.7604, -95.3698, 'Houston', 'TX'),
  ('77002', 29.7604, -95.3590, 'Houston', 'TX'),
  ('77005', 29.7200, -95.4200, 'Houston', 'TX'),
  ('77019', 29.7600, -95.3800, 'Houston', 'TX'),
  ('77057', 29.7300, -95.4700, 'Houston', 'TX'),
  ('78701', 30.2672, -97.7431, 'Austin', 'TX'),
  ('78702', 30.2600, -97.7200, 'Austin', 'TX'),
  ('78704', 30.2500, -97.7600, 'Austin', 'TX'),
  ('78741', 30.2300, -97.7100, 'Austin', 'TX'),
  ('80201', 39.7392, -104.9903, 'Denver', 'CO'),
  ('80202', 39.7392, -104.9903, 'Denver', 'CO'),
  ('80205', 39.7600, -104.9700, 'Denver', 'CO'),
  ('80210', 39.6900, -104.9800, 'Denver', 'CO'),
  ('85001', 33.4484, -112.0740, 'Phoenix', 'AZ'),
  ('85004', 33.4300, -112.0300, 'Phoenix', 'AZ'),
  ('85008', 33.4500, -111.9900, 'Phoenix', 'AZ'),
  ('85016', 33.5000, -112.0300, 'Phoenix', 'AZ'),
  ('90001', 33.9742, -118.2480, 'Los Angeles', 'CA'),
  ('90010', 34.0620, -118.3060, 'Los Angeles', 'CA'),
  ('90012', 34.0660, -118.2440, 'Los Angeles', 'CA'),
  ('90017', 34.0520, -118.2610, 'Los Angeles', 'CA'),
  ('90024', 34.0620, -118.4400, 'Los Angeles', 'CA'),
  ('90026', 34.0840, -118.2680, 'Los Angeles', 'CA'),
  ('90028', 34.1010, -118.3270, 'Los Angeles', 'CA'),
  ('90042', 34.1100, -118.2000, 'Los Angeles', 'CA'),
  ('90048', 34.0740, -118.3700, 'Los Angeles', 'CA'),
  ('90064', 34.0300, -118.4300, 'Los Angeles', 'CA'),
  ('90210', 34.0901, -118.4065, 'Beverly Hills', 'CA'),
  ('90245', 33.9200, -118.3900, 'El Segundo', 'CA'),
  ('90291', 33.9900, -118.4600, 'Venice', 'CA'),
  ('94102', 37.7790, -122.4130, 'San Francisco', 'CA'),
  ('94103', 37.7720, -122.4100, 'San Francisco', 'CA'),
  ('94107', 37.7700, -122.3900, 'San Francisco', 'CA'),
  ('94109', 37.7900, -122.4200, 'San Francisco', 'CA'),
  ('94110', 37.7600, -122.4100, 'San Francisco', 'CA'),
  ('94115', 37.7800, -122.4400, 'San Francisco', 'CA'),
  ('94117', 37.7700, -122.4400, 'San Francisco', 'CA'),
  ('94121', 37.7800, -122.4900, 'San Francisco', 'CA'),
  ('94133', 37.8000, -122.4100, 'San Francisco', 'CA'),
  ('94158', 37.7700, -122.3900, 'San Francisco', 'CA'),
  ('94025', 37.4530, -122.1810, 'Menlo Park', 'CA'),
  ('94043', 37.4100, -122.0700, 'Mountain View', 'CA'),
  ('94301', 37.4410, -122.1430, 'Palo Alto', 'CA'),
  ('95030', 37.2270, -121.9800, 'Los Gatos', 'CA'),
  ('95110', 37.3400, -121.9000, 'San Jose', 'CA'),
  ('95112', 37.3500, -121.8900, 'San Jose', 'CA'),
  ('95120', 37.3500, -121.8300, 'San Jose', 'CA'),
  ('95125', 37.3000, -121.8900, 'San Jose', 'CA'),
  ('95814', 38.5790, -121.4960, 'Sacramento', 'CA'),
  ('95818', 38.5600, -121.4900, 'Sacramento', 'CA'),
  ('95820', 38.5400, -121.4700, 'Sacramento', 'CA'),
  ('97201', 45.5100, -122.6800, 'Portland', 'OR'),
  ('97205', 45.5200, -122.6800, 'Portland', 'OR'),
  ('97209', 45.5300, -122.6700, 'Portland', 'OR'),
  ('97214', 45.5100, -122.6400, 'Portland', 'OR'),
  ('98101', 47.6097, -122.3331, 'Seattle', 'WA'),
  ('98102', 47.6200, -122.3200, 'Seattle', 'WA'),
  ('98103', 47.6600, -122.3400, 'Seattle', 'WA'),
  ('98105', 47.6600, -122.3000, 'Seattle', 'WA'),
  ('98109', 47.6300, -122.3400, 'Seattle', 'WA'),
  ('98115', 47.6800, -122.3200, 'Seattle', 'WA'),
  ('98117', 47.6900, -122.3800, 'Seattle', 'WA'),
  ('98122', 47.6100, -122.3100, 'Seattle', 'WA'),
  ('98144', 47.5900, -122.3000, 'Seattle', 'WA'),
  ('98199', 47.6400, -122.4000, 'Seattle', 'WA')
on conflict (zip_code) do nothing;
