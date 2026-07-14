const uid = () => crypto.randomUUID()

const now = Date.now()
const days = (n: number) => new Date(now - n * 864e5).toISOString()
const hours = (n: number) => new Date(now - n * 36e5).toISOString()

const initialData = {
  trends: [
    { id: 't1', name: 'NeeDoh', slug: 'needoh', description: 'Schylling sensory fidget toys — 50+ styles of squishy, squeezy, stretchy stress balls. TikTok viral 2025-2026.', is_active: true, created_at: days(120) },
    { id: 't2', name: 'Mystery Squishy Dumpling', slug: 'mystery-squishy-dumpling', description: 'RMS USA blind-box bao bun squishies with rarity tiers. 500M+ TikTok views. Sells out within an hour.', is_active: true, created_at: days(90) },
    { id: 't3', name: 'Sunny Days Squeezy', slug: 'sunny-days-squeezy', description: 'Jumbo food-shaped slow-rising foam squishies at Target. Banana, butter, cheese, carrot & more.', is_active: true, created_at: days(60) },
    { id: 't4', name: 'Taba Squishy', slug: 'taba-squishy', description: 'Handmade food-grade silicone animal squishies. Capybara, hamster, duck & more. TikTok ASMR viral.', is_active: true, created_at: days(45) },
    { id: 't5', name: 'Magic Jellykins', slug: 'magic-jellykins', description: 'Spin Master water-activated reveal plushies. 20 food-themed animals to collect. Summer 2026 viral.', is_active: true, created_at: days(20) },
  ],
  products: [
    // NeeDoh (49) — t1
    { id: 'p1', trend_id: 't1', name: 'Classic NeeDoh Groovy Glob', slug: 'needoh-classic-groovy-glob', created_at: days(120) },
    { id: 'p2', trend_id: 't1', name: 'NeeDoh Nice Cube', slug: 'needoh-nice-cube', created_at: days(120) },
    { id: 'p3', trend_id: 't1', name: 'NeeDoh Cool Cats', slug: 'needoh-cool-cats', created_at: days(110) },
    { id: 'p4', trend_id: 't1', name: 'NeeDoh Funky Pups', slug: 'needoh-funky-pups', created_at: days(110) },
    { id: 'p5', trend_id: 't1', name: 'NeeDoh Dream Drop', slug: 'needoh-dream-drop', created_at: days(100) },
    { id: 'p6', trend_id: 't1', name: 'NeeDoh Gummy Bear', slug: 'needoh-gummy-bear', created_at: days(100) },
    { id: 'p7', trend_id: 't1', name: 'Super NeeDoh', slug: 'needoh-super-needoh', created_at: days(95) },
    { id: 'p8', trend_id: 't1', name: 'Color Changing NeeDoh', slug: 'needoh-color-changing', created_at: days(95) },
    { id: 'p9', trend_id: 't1', name: 'NeeDoh Gumdrop', slug: 'needoh-gumdrop', created_at: days(90) },
    { id: 'p10', trend_id: 't1', name: 'NeeDoh Nice Berg', slug: 'needoh-nice-berg', created_at: days(90) },
    { id: 'p11', trend_id: 't1', name: 'NeeDoh Nice Cream', slug: 'needoh-nice-cream', created_at: days(85) },
    { id: 'p12', trend_id: 't1', name: 'NeeDoh Dig It Pig', slug: 'needoh-dig-it-pig', created_at: days(85) },
    { id: 'p13', trend_id: 't1', name: 'NeeDoh Good Vibes', slug: 'needoh-good-vibes', created_at: days(80) },
    { id: 'p14', trend_id: 't1', name: 'NeeDoh Dohnut', slug: 'needoh-dohnut', created_at: days(80) },
    { id: 'p15', trend_id: 't1', name: 'NeeDoh Jelly Dohnut', slug: 'needoh-jelly-dohnut', created_at: days(75) },
    { id: 'p16', trend_id: 't1', name: 'NeeDoh Dohnut Holes', slug: 'needoh-dohnut-holes', created_at: days(75) },
    { id: 'p17', trend_id: 't1', name: 'NeeDoh Squeezza', slug: 'needoh-squeezza', created_at: days(70) },
    { id: 'p18', trend_id: 't1', name: 'NeeDoh Peace o Cake', slug: 'needoh-peace-o-cake', created_at: days(70) },
    { id: 'p19', trend_id: 't1', name: 'NeeDoh Nicesicle', slug: 'needoh-nicesicle', created_at: days(65) },
    { id: 'p20', trend_id: 't1', name: 'NeeDoh Mello Mallo', slug: 'needoh-mello-mallo', created_at: days(65) },
    { id: 'p21', trend_id: 't1', name: 'NeeDoh Ramen Noodlies', slug: 'needoh-ramen-noodlies', created_at: days(60) },
    { id: 'p22', trend_id: 't1', name: 'NeeDoh Groovy Fruit', slug: 'needoh-groovy-fruit', created_at: days(60) },
    { id: 'p23', trend_id: 't1', name: 'NeeDoh Nice Cube Swirl', slug: 'needoh-nice-cube-swirl', created_at: days(55) },
    { id: 'p24', trend_id: 't1', name: 'NeeDoh Nice Cube Glow', slug: 'needoh-nice-cube-glow', created_at: days(55) },
    { id: 'p25', trend_id: 't1', name: 'NeeDoh Nice Ice Baby', slug: 'needoh-nice-ice-baby', created_at: days(50) },
    { id: 'p26', trend_id: 't1', name: 'NeeDoh Glitter & Glow Niceberg', slug: 'needoh-glitter-glow-niceberg', created_at: days(50) },
    { id: 'p27', trend_id: 't1', name: 'NeeDoh Teenie Singles', slug: 'needoh-teenie-singles', created_at: days(45) },
    { id: 'p28', trend_id: 't1', name: 'NeeDoh Teenie Classic 3-Pack', slug: 'needoh-teenie-classic-3pack', created_at: days(45) },
    { id: 'p29', trend_id: 't1', name: 'NeeDoh Teenie Cool Cats', slug: 'needoh-teenie-cool-cats', created_at: days(40) },
    { id: 'p30', trend_id: 't1', name: 'NeeDoh Teenie Funky Pups', slug: 'needoh-teenie-funky-pups', created_at: days(40) },
    { id: 'p31', trend_id: 't1', name: 'NeeDoh Hot Shot Teenie', slug: 'needoh-hot-shot-teenie', created_at: days(35) },
    { id: 'p32', trend_id: 't1', name: 'NeeDoh Super Cool Cats', slug: 'needoh-super-cool-cats', created_at: days(35) },
    { id: 'p33', trend_id: 't1', name: 'NeeDoh Jelly Squish', slug: 'needoh-jelly-squish', created_at: days(30) },
    { id: 'p34', trend_id: 't1', name: 'NeeDoh Bunnies & Chicks', slug: 'needoh-bunnies-chicks', created_at: days(30) },
    { id: 'p35', trend_id: 't1', name: 'NeeDoh Polar Glow Penguin', slug: 'needoh-polar-glow-penguin', created_at: days(25) },
    { id: 'p36', trend_id: 't1', name: 'NeeDoh Chicka Deedos', slug: 'needoh-chicka-deedos', created_at: days(25) },
    { id: 'p37', trend_id: 't1', name: 'NeeDoh Shaggy', slug: 'needoh-shaggy', created_at: days(20) },
    { id: 'p38', trend_id: 't1', name: 'NeeDoh Fuzz Ball Flower Power', slug: 'needoh-fuzz-ball-flower-power', created_at: days(20) },
    { id: 'p39', trend_id: 't1', name: 'NeeDoh Fuzz Ball Wonder Waves', slug: 'needoh-fuzz-ball-wonder-waves', created_at: days(15) },
    { id: 'p40', trend_id: 't1', name: 'NeeDoh Wild Cats Fuzz Ball', slug: 'needoh-wild-cats-fuzz-ball', created_at: days(15) },
    { id: 'p41', trend_id: 't1', name: 'NeeDoh Snowball Crunch', slug: 'needoh-snowball-crunch', created_at: days(10) },
    { id: 'p42', trend_id: 't1', name: 'NeeDoh SplootSplat', slug: 'needoh-splootsplat', created_at: days(10) },
    { id: 'p43', trend_id: 't1', name: 'NeeDoh Marbleez', slug: 'needoh-marbleez', created_at: days(8) },
    { id: 'p44', trend_id: 't1', name: 'NeeDoh Groovy Jewel', slug: 'needoh-groovy-jewel', created_at: days(8) },
    { id: 'p45', trend_id: 't1', name: 'NeeDoh Dippin Dazzler', slug: 'needoh-dippin-dazzler', created_at: days(5) },
    { id: 'p46', trend_id: 't1', name: 'NeeDoh Swirlie Egg', slug: 'needoh-swirlie-egg', created_at: days(5) },
    { id: 'p47', trend_id: 't1', name: 'NeeDoh Squeeze Hearts', slug: 'needoh-squeeze-hearts', created_at: days(3) },
    { id: 'p48', trend_id: 't1', name: 'NeeDoh Advent Calendar', slug: 'needoh-advent-calendar', created_at: days(3) },
    // Mystery Squishy Dumpling (20) — t2
    { id: 'p49', trend_id: 't2', name: 'Mystery Dumpling Series 1 (Original)', slug: 'dumpling-series-1-original', created_at: days(90) },
    { id: 'p50', trend_id: 't2', name: 'Mystery Dumpling Series 2', slug: 'dumpling-series-2', created_at: days(80) },
    { id: 'p51', trend_id: 't2', name: 'Mystery Dumpling Series 3 Rainbow', slug: 'dumpling-series-3-rainbow', created_at: days(70) },
    { id: 'p52', trend_id: 't2', name: 'MINI Mystery Dumpling Series 1', slug: 'dumpling-mini-series-1', created_at: days(65) },
    { id: 'p53', trend_id: 't2', name: 'MINI Mystery Dumpling Series 3', slug: 'dumpling-mini-series-3', created_at: days(60) },
    { id: 'p54', trend_id: 't2', name: 'Mystery Big Bao Bun 7 inch', slug: 'dumpling-big-bao-bun-7inch', created_at: days(55) },
    { id: 'p55', trend_id: 't2', name: 'Super Mega Jumbo Rainbow Dumpling', slug: 'dumpling-super-mega-jumbo-rainbow', created_at: days(50) },
    { id: 'p56', trend_id: 't2', name: 'Golden Ticket Edition Dumpling', slug: 'dumpling-golden-ticket-edition', created_at: days(40) },
    { id: 'p57', trend_id: 't2', name: 'Seashell Series Dumpling', slug: 'dumpling-seashell-series', created_at: days(35) },
    { id: 'p58', trend_id: 't2', name: 'Sunset Series Dumpling', slug: 'dumpling-sunset-series', created_at: days(30) },
    { id: 'p59', trend_id: 't2', name: 'Americana Edition Dumpling', slug: 'dumpling-americana-edition', created_at: days(25) },
    { id: 'p60', trend_id: 't2', name: 'Shark Edition Dumpling', slug: 'dumpling-shark-edition', created_at: days(20) },
    { id: 'p61', trend_id: 't2', name: 'Starlight Series Dumpling', slug: 'dumpling-starlight-series', created_at: days(15) },
    { id: 'p62', trend_id: 't2', name: 'Rose Gold Glitter Dumpling', slug: 'dumpling-rose-gold-glitter', created_at: days(12) },
    { id: 'p63', trend_id: 't2', name: 'Sugar Edition Dumpling', slug: 'dumpling-sugar-edition', created_at: days(10) },
    { id: 'p64', trend_id: 't2', name: 'Dumpling Advent Calendar', slug: 'dumpling-advent-calendar', created_at: days(8) },
    { id: 'p65', trend_id: 't2', name: 'Dumpling Multi-Pack 2x', slug: 'dumpling-multipack-2x', created_at: days(5) },
    { id: 'p66', trend_id: 't2', name: 'Dumpling Multi-Pack 4x', slug: 'dumpling-multipack-4x', created_at: days(5) },
    { id: 'p67', trend_id: 't2', name: 'Pink Glitter Dumpling', slug: 'dumpling-pink-glitter', created_at: days(3) },
    { id: 'p68', trend_id: 't2', name: 'Galaxy Glitter Dumpling', slug: 'dumpling-galaxy-glitter', created_at: days(3) },
    // Sunny Days Squeezy (13) — t3
    { id: 'p69', trend_id: 't3', name: 'Squeezy Banana', slug: 'squeezy-banana', created_at: days(60) },
    { id: 'p70', trend_id: 't3', name: 'Squeezy Butter Shape', slug: 'squeezy-butter-shape', created_at: days(60) },
    { id: 'p71', trend_id: 't3', name: 'Squeezy Cheese Block', slug: 'squeezy-cheese-block', created_at: days(55) },
    { id: 'p72', trend_id: 't3', name: 'Squeezy Carrot', slug: 'squeezy-carrot', created_at: days(55) },
    { id: 'p73', trend_id: 't3', name: 'Squeezy Peach', slug: 'squeezy-peach', created_at: days(50) },
    { id: 'p74', trend_id: 't3', name: 'Squeezy Pickle', slug: 'squeezy-pickle', created_at: days(50) },
    { id: 'p75', trend_id: 't3', name: 'Squeezy Strawberry', slug: 'squeezy-strawberry', created_at: days(45) },
    { id: 'p76', trend_id: 't3', name: 'Squeezy Grape', slug: 'squeezy-grape', created_at: days(45) },
    { id: 'p77', trend_id: 't3', name: 'Squeezy Cherry', slug: 'squeezy-cherry', created_at: days(40) },
    { id: 'p78', trend_id: 't3', name: 'Squeezy Apple', slug: 'squeezy-apple', created_at: days(40) },
    { id: 'p79', trend_id: 't3', name: 'Squeezy Ice Cream Sandwich', slug: 'squeezy-ice-cream-sandwich', created_at: days(30) },
    { id: 'p80', trend_id: 't3', name: 'Squeezy Croissant', slug: 'squeezy-croissant', created_at: days(20) },
    { id: 'p81', trend_id: 't3', name: 'Squeezy Americana Rubber Ducks 4pk', slug: 'squeezy-americana-rubber-ducks-4pk', created_at: days(15) },
    // Taba Squishy (12) — t4
    { id: 'p82', trend_id: 't4', name: 'Sleeping Capybara Taba Squishy', slug: 'taba-sleeping-capybara', created_at: days(45) },
    { id: 'p83', trend_id: 't4', name: 'Flocked Chick Taba Squishy', slug: 'taba-flocked-chick', created_at: days(40) },
    { id: 'p84', trend_id: 't4', name: 'Flocked Hamster Taba Squishy', slug: 'taba-flocked-hamster', created_at: days(40) },
    { id: 'p85', trend_id: 't4', name: 'Flocked White Hamster Taba Squishy', slug: 'taba-flocked-white-hamster', created_at: days(35) },
    { id: 'p86', trend_id: 't4', name: 'Light Yellow Bear Taba Squishy', slug: 'taba-light-yellow-bear', created_at: days(35) },
    { id: 'p87', trend_id: 't4', name: 'Glitter Transparent Jellyfish Taba Squishy', slug: 'taba-glitter-transparent-jellyfish', created_at: days(30) },
    { id: 'p88', trend_id: 't4', name: 'Taba Paw Squishy', slug: 'taba-paw', created_at: days(25) },
    { id: 'p89', trend_id: 't4', name: 'Flocked Duck Taba Squishy', slug: 'taba-flocked-duck', created_at: days(25) },
    { id: 'p90', trend_id: 't4', name: 'Cat Taba Squishy', slug: 'taba-cat', created_at: days(20) },
    { id: 'p91', trend_id: 't4', name: 'Turtle Taba Squishy', slug: 'taba-turtle', created_at: days(15) },
    { id: 'p92', trend_id: 't4', name: 'Seal Taba Squishy', slug: 'taba-seal', created_at: days(10) },
    { id: 'p93', trend_id: 't4', name: 'Axolotl Taba Squishy', slug: 'taba-axolotl', created_at: days(5) },
    // Magic Jellykins (3) — t5
    { id: 'p94', trend_id: 't5', name: 'Magic Jellykins Surprise Plush Single', slug: 'magic-jellykins-surprise-plush-single', created_at: days(20) },
    { id: 'p95', trend_id: 't5', name: 'Magic Jellykins Surprise Plush Jar 2-Pack', slug: 'magic-jellykins-surprise-plush-jar-2pack', created_at: days(20) },
    { id: 'p96', trend_id: 't5', name: 'Magic Jellykins Doll Playset 12pk', slug: 'magic-jellykins-doll-playset-12pk', created_at: days(10) },
  ],
  retailers: [
    { id: 'r1', name: 'Target', website_url: 'https://www.target.com', is_active: true },
    { id: 'r2', name: 'Meijer', website_url: 'https://www.meijer.com', is_active: true },
    { id: 'r3', name: 'Five Below', website_url: 'https://www.fivebelow.com', is_active: true },
    { id: 'r4', name: 'Walmart', website_url: 'https://www.walmart.com', is_active: true },
    { id: 'r5', name: 'Barnes & Noble', website_url: 'https://www.barnesandnoble.com', is_active: true },
  ],
  stores: [
    { id: 'st1', slug: 'target-lansing-edgewood', retailer_name: 'Target', store_name: 'Target Lansing Edgewood', address_line1: '500 E Edgewood Blvd', city: 'Lansing', state: 'MI', zip_code: '48911', is_active: true },
    { id: 'st2', slug: 'meijer-lansing-s-pennsylvania', retailer_name: 'Meijer', store_name: 'Meijer Lansing', address_line1: '6200 S Pennsylvania Ave', city: 'Lansing', state: 'MI', zip_code: '48911', is_active: true },
    { id: 'st3', slug: 'five-below-eastwood', retailer_name: 'Five Below', store_name: 'Five Below Eastwood', address_line1: '2925 Preyde Blvd', city: 'Lansing', state: 'MI', zip_code: '48912', is_active: true },
  ],
  profiles: [
    { id: 'u1', username: 'DemoHunter', karma: 12, is_pro: true, created_at: days(90) },
    { id: 'u2', username: 'SquishFan22', karma: 5, is_pro: false, created_at: days(60) },
    { id: 'u3', username: 'TargetScout', karma: 8, is_pro: false, created_at: days(45) },
    { id: 'u4', username: 'DumplingDiva', karma: 15, is_pro: false, created_at: days(80) },
  ],
  profile_contacts: [
    { user_id: 'u1', contact_info: 'demo@finditviral.com', created_at: days(90), updated_at: days(90) },
    { user_id: 'u2', contact_info: 'poster@finditviral.com', created_at: days(60), updated_at: days(60) },
  ],
  early_access_requests: [],
  bounties: [
    { id: 'b1', user_id: 'u2', product_id: 'p2', reward_amount: 25, zip_code: '10001', radius_miles: 50, notes: 'Looking for the blue Nice Cube', status: 'open', created_at: hours(5) },
    { id: 'b2', user_id: 'u2', product_id: 'p10', reward_amount: 30, zip_code: '90210', radius_miles: 25, notes: 'Need the Nice Berg for a gift', status: 'open', created_at: hours(12) },
    { id: 'b3', user_id: 'u4', product_id: 'p51', reward_amount: 50, zip_code: '60601', radius_miles: 75, notes: 'Hunting the Series 3 Rainbow — will pay extra for glitter', status: 'open', created_at: hours(3) },
    { id: 'b4', user_id: 'u4', product_id: 'p56', reward_amount: 100, zip_code: '30301', radius_miles: 100, notes: 'Golden Ticket edition! Will pay $100+', status: 'open', created_at: hours(8) },
    { id: 'b5', user_id: 'u3', product_id: 'p69', reward_amount: 15, zip_code: '10001', radius_miles: 30, notes: 'Squeezy Banana — my kid is obsessed', status: 'open', created_at: hours(20) },
    { id: 'b6', user_id: 'u3', product_id: 'p70', reward_amount: 15, zip_code: '10001', radius_miles: 30, notes: 'Squeezy Butter Shape', status: 'open', created_at: hours(18) },
    { id: 'b7', user_id: 'u2', product_id: 'p82', reward_amount: 20, zip_code: '94102', radius_miles: 50, notes: 'Sleeping Capybara — sold out everywhere', status: 'open', created_at: hours(6) },
    { id: 'b8', user_id: 'u4', product_id: 'p67', reward_amount: 40, zip_code: '75201', radius_miles: 50, notes: 'Pink Glitter Dumpling chase pull', status: 'open', created_at: hours(2) },
    { id: 'b9', user_id: 'u3', product_id: 'p95', reward_amount: 25, zip_code: '98101', radius_miles: 40, notes: 'Jellykins 2-Pack for birthday party', status: 'open', created_at: hours(14) },
    { id: 'b10', user_id: 'u2', product_id: 'p71', reward_amount: 15, zip_code: '90210', radius_miles: 25, notes: 'Squeezy Cheese Block', status: 'open', created_at: hours(36) },
  ],
  sightings: [
    { id: 's1', user_id: 'u1', product_id: 'p2', store_name: 'Five Below', city: 'New York', state: 'NY', zip_code: '10001', stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: ['https://images.unsplash.com/photo-1558862107-49d60d35c045?w=200', 'https://images.unsplash.com/photo-1614164185285-7c4d1b6e5c1e?w=200'], created_at: hours(2) },
    { id: 's2', user_id: 'u1', product_id: 'p1', store_name: 'Walmart Supercenter', city: 'Beverly Hills', state: 'CA', zip_code: '90210', stock_level: 'low', is_public: true, bounty_id: null, photo_urls: ['https://images.unsplash.com/photo-1558862107-49d60d35c045?w=200'], created_at: hours(8) },
    { id: 's3', user_id: 'u3', product_id: 'p69', store_name: 'Target', city: 'New York', state: 'NY', zip_code: '10001', stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(4) },
    { id: 's4', user_id: 'u3', product_id: 'p70', store_name: 'Target', city: 'Chicago', state: 'IL', zip_code: '60601', stock_level: 'low', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(6) },
    { id: 's5', user_id: 'u4', product_id: 'p51', store_name: 'Five Below', city: 'Atlanta', state: 'GA', zip_code: '30301', stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(1) },
    { id: 's6', user_id: 'u1', product_id: 'p82', store_name: 'Barnes & Noble', city: 'San Francisco', state: 'CA', zip_code: '94102', stock_level: 'low', is_public: true, bounty_id: null, photo_urls: ['https://images.unsplash.com/photo-1558862107-49d60d35c045?w=200', 'https://images.unsplash.com/photo-1614164185285-7c4d1b6e5c1e?w=200', 'https://images.unsplash.com/photo-1587654780291-39c4409d35c0?w=200'], created_at: hours(10) },
    { id: 's7', user_id: 'u4', product_id: 'p49', store_name: 'Five Below', city: 'Dallas', state: 'TX', zip_code: '75201', stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(3) },
    { id: 's8', user_id: 'u3', product_id: 'p71', store_name: 'Target', city: 'Seattle', state: 'WA', zip_code: '98101', stock_level: 'none', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(16) },
    { id: 's9', user_id: 'u1', product_id: 'p23', store_name: 'Michael\'s', city: 'New York', state: 'NY', zip_code: '10001', stock_level: 'low', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(5) },
    { id: 's10', user_id: 'u4', product_id: 'p94', store_name: 'Target', city: 'Chicago', state: 'IL', zip_code: '60601', stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: null, created_at: hours(7) },
  ],
  bounty_claims: [] as any[],
  contribution_drafts: [] as any[],
  product_suggestions: [] as any[],
  store_suggestions: [] as any[],
  interest_events: [] as any[],
  member_restrictions: [] as any[],
  moderation_events: [] as any[],
  zip_codes: [
    { zip_code: '10001', latitude: 40.7484, longitude: -73.9967, city: 'New York', state: 'NY' },
    { zip_code: '90210', latitude: 34.0901, longitude: -118.4065, city: 'Beverly Hills', state: 'CA' },
    { zip_code: '60601', latitude: 41.8855, longitude: -87.6217, city: 'Chicago', state: 'IL' },
    { zip_code: '30301', latitude: 33.749, longitude: -84.388, city: 'Atlanta', state: 'GA' },
    { zip_code: '75201', latitude: 32.7791, longitude: -96.8037, city: 'Dallas', state: 'TX' },
    { zip_code: '94102', latitude: 37.779, longitude: -122.413, city: 'San Francisco', state: 'CA' },
    { zip_code: '98101', latitude: 47.6097, longitude: -122.3331, city: 'Seattle', state: 'WA' },
    { zip_code: '33101', latitude: 25.7743, longitude: -80.1937, city: 'Miami', state: 'FL' },
    { zip_code: '77001', latitude: 29.7604, longitude: -95.3698, city: 'Houston', state: 'TX' },
    { zip_code: '85001', latitude: 33.4484, longitude: -112.074, city: 'Phoenix', state: 'AZ' },
  ],
}

const store: Record<string, any[]> = JSON.parse(JSON.stringify(initialData))
store.products.forEach((product) => Object.assign(product, {
  availability_status: 'available',
  source_url: 'https://example.com/mock-product',
  retailer: 'Mock retailer',
  release_date: null,
  verified_at: new Date().toISOString(),
  is_active: true,
}))
store.bounties.forEach((bounty) => Object.assign(bounty, {
  reward_cents: Math.round((bounty.reward_amount ?? 0) * 100),
  requirements: bounty.notes ?? null,
  deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
  moderation_status: 'approved',
}))
store.sightings.forEach((sighting, index) => Object.assign(sighting, {
  store_id: store.stores[index % store.stores.length].id,
  store_name: store.stores[index % store.stores.length].store_name,
  city: store.stores[index % store.stores.length].city,
  state: 'MI',
  zip_code: store.stores[index % store.stores.length].zip_code,
  availability: sighting.stock_level === 'none' ? 'sold_out' : sighting.stock_level === 'low' ? 'low_stock' : 'in_stock',
  seen_at: sighting.created_at,
  moderation_status: 'approved',
}))
let mockSession: any = null
const listeners: ((event: string, session: any) => void)[] = []

function attachRels(table: string, row: any) {
  if (table === 'bounties' || table === 'sightings') {
    row.product = store.products.find(p => p.id === row.product_id) ?? null
    row.profile = store.profiles.find(p => p.id === row.user_id) ?? null
  }
  if (table === 'products') row.trend = store.trends.find(t => t.id === row.trend_id) ?? null
  if (table === 'bounty_claims') {
    row.bounty = store.bounties.find(b => b.id === row.bounty_id) ?? null
    row.finder = store.profiles.find(p => p.id === row.finder_id) ?? null
    row.sighting = store.sightings.find(s => s.id === row.sighting_id) ?? null
  }
  return row
}

class Builder {
  private t: string
  private filters: [string, any, string][] = []
  private oc?: string
  private oa = true
  private ln?: number
  private isSingle = false
  private ins: any = null
  private ups: any = null
  private upd: any = null

  constructor(t: string) { this.t = t }
  select() { return this }
  eq(c: string, v: any) { this.filters.push([c, v, 'eq']); return this }
  in(c: string, v: any[]) { this.filters.push([c, v, 'in']); return this }
  order(c: string, o?: { ascending?: boolean }) { this.oc = c; this.oa = o?.ascending ?? true; return this }
  limit(n: number) { this.ln = n; return this }
  single() { this.isSingle = true; return this }
  maybeSingle() { this.isSingle = true; return this }
  insert(d: any) { this.ins = d; return this }
  upsert(d: any) { this.ups = d; return this }
  update(d: any) { this.upd = d; return this }

  then(res: any, rej?: any) {
    if (this.ins || this.ups) {
      const payload = this.ins || this.ups
      const items = Array.isArray(payload) ? payload : [payload]
      const rows = items.map(item => {
        const key = this.t === 'profile_contacts' ? 'user_id' : 'id'
        const id = item[key] || item.id || item.user_id || uid()
        const idx = store[this.t].findIndex(r => r[key] === id)
        if (idx >= 0) { Object.assign(store[this.t][idx], item); return store[this.t][idx] }
        const defaults = this.t === 'bounties'
          ? { status: 'open', user_id: mockSession?.user?.id }
          : this.t === 'sightings'
            ? { stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: null, user_id: mockSession?.user?.id }
            : {}
        const r = { ...defaults, ...item, [key]: id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        store[this.t].push(r)
        return r
      })
      return Promise.resolve({ data: this.isSingle ? rows[0] : rows, error: null }).then(res, rej)
    }
    if (this.upd) {
      store[this.t].forEach(r => {
        if (this.filters.every(([c, v, op]) => op === 'eq' ? r[c] === v : v.includes(r[c])))
          Object.assign(r, this.upd)
      })
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    let rows = [...(store[this.t] || [])]
    for (const [c, v, op] of this.filters) {
      if (op === 'eq') rows = rows.filter(r => r[c] === v)
      else if (op === 'in') rows = rows.filter(r => v.includes(r[c]))
    }
    if (this.oc) rows.sort((a, b) => {
      const av = a[this.oc!], bv = b[this.oc!]
      return (av < bv ? -1 : av > bv ? 1 : 0) * (this.oa ? 1 : -1)
    })
    if (this.ln) rows = rows.slice(0, this.ln)
    rows = rows.map(r => attachRels(this.t, { ...r }))
    return Promise.resolve({ data: this.isSingle ? rows[0] ?? null : rows, error: null }).then(res, rej)
  }
}

export const mockSupabase = {
  from(t: string) { return new Builder(t) },
  rpc(name: string, args: any) {
    if (name === 'search_products') {
      const query = String(args?.p_query ?? '').trim().toLowerCase()
      const matches = store.products
        .filter(product => product.is_active && product.name.toLowerCase().includes(query))
        .slice(0, Math.min(Number(args?.p_limit) || 12, 12))
        .map(product => ({
          id: product.id,
          name: product.name,
          slug: product.slug,
          trend_name: store.trends.find(trend => trend.id === product.trend_id)?.name ?? null,
          availability_status: product.availability_status,
          release_date: product.release_date,
          image_url: null,
        }))
      return Promise.resolve({ data: matches, error: null })
    }

    if (name === 'search_stores') {
      const query = String(args?.p_query ?? '').trim().toLowerCase()
      const matches = store.stores
        .filter(location => location.is_active && [location.store_name, location.retailer_name, location.city, location.zip_code].some(value => String(value).toLowerCase().includes(query)))
        .slice(0, Math.min(Number(args?.p_limit) || 12, 12))
      return Promise.resolve({ data: matches, error: null })
    }

    if (name === 'get_public_product') {
      const product = store.products.find(item => item.slug === args?.p_slug && item.is_active)
      if (!product) return Promise.resolve({ data: [], error: null })
      const trend = store.trends.find(item => item.id === product.trend_id)
      return Promise.resolve({ data: [{
        id: product.id,
        name: product.name,
        slug: product.slug,
        trend_id: product.trend_id,
        trend_name: trend?.name ?? null,
        trend_slug: trend?.slug ?? null,
        availability_status: product.availability_status,
        release_date: product.release_date,
        retailer: product.retailer,
        source_url: product.source_url,
        image_url: null,
        image_attribution: null,
        latest_seen_at: null,
        approved_sighting_count: store.sightings.filter(item => item.product_id === product.id && item.moderation_status === 'approved').length,
        open_bounty_count: store.bounties.filter(item => item.product_id === product.id && item.status === 'open' && item.moderation_status === 'approved').length,
      }], error: null })
    }

    if (name === 'list_public_stores' || name === 'get_public_store') {
      const query = String(args?.p_query ?? '').trim().toLowerCase()
      let locations = store.stores.filter(location => location.is_active)
      if (name === 'get_public_store') locations = locations.filter(location => location.slug === args?.p_slug)
      else if (query) locations = locations.filter(location => [location.store_name, location.retailer_name, location.city, location.zip_code].some(value => String(value).toLowerCase().includes(query)))
      return Promise.resolve({ data: locations.map(location => ({
        ...location,
        latest_seen_at: store.sightings.filter(item => item.store_id === location.id).sort((a, b) => b.seen_at.localeCompare(a.seen_at))[0]?.seen_at ?? null,
        approved_sighting_count: store.sightings.filter(item => item.store_id === location.id && item.moderation_status === 'approved').length,
      })), error: null })
    }

    if (name === 'list_public_sightings') {
      const rows = store.sightings
        .filter(item => item.moderation_status === 'approved'
          && (!args?.p_product_id || item.product_id === args.p_product_id)
          && (!args?.p_store_id || item.store_id === args.p_store_id))
        .slice(0, Number(args?.p_limit) || 50)
        .map(item => {
          const product = store.products.find(candidate => candidate.id === item.product_id)
          const location = store.stores.find(candidate => candidate.id === item.store_id)
          return { ...item, product_name: product?.name, product_slug: product?.slug, store_slug: location?.slug, retailer_name: location?.retailer_name, distance_miles: 3.2 }
        })
      return Promise.resolve({ data: rows, error: null })
    }

    if (name === 'list_public_bounties') {
      const rows = store.bounties
        .filter(item => item.status === 'open' && item.moderation_status === 'approved' && (!args?.p_product_id || item.product_id === args.p_product_id))
        .slice(0, Number(args?.p_limit) || 50)
        .map(item => {
          const product = store.products.find(candidate => candidate.id === item.product_id)
          const location = store.stores.find(candidate => candidate.id === item.store_id)
          return { ...item, product_name: product?.name, product_slug: product?.slug, store_name: location?.store_name ?? null, store_slug: location?.slug ?? null, retailer_name: location?.retailer_name ?? null, distance_miles: 4.6 }
        })
      return Promise.resolve({ data: rows, error: null })
    }

    const currentUserId = mockSession?.user?.id
    if (!currentUserId) {
      return Promise.resolve({ data: null, error: { message: 'Authentication required' } })
    }

    if (name === 'is_app_owner') {
      return Promise.resolve({ data: currentUserId === 'u1', error: null })
    }

    if (name === 'get_my_profile') {
      const profile = store.profiles.find(p => p.id === currentUserId) ?? null
      return Promise.resolve({ data: profile ? [profile] : [], error: null })
    }

    if (name === 'get_trend_click_heat') {
      const products = store.products.filter(
        product => product.trend_id === args?.p_trend_id && product.is_active,
      )
      return Promise.resolve({
        data: products.map(product => ({
          product_id: product.id,
          heat_percent: 0,
          total_clicks: 0,
          product_count: products.length,
          has_signal: false,
        })),
        error: null,
      })
    }

    if (name === 'is_username_available') {
      const username = String(args?.p_username ?? '').trim().toLowerCase()
      const available = /^[a-z]{3,20}$/.test(username)
        && !store.profiles.some(p => p.id !== currentUserId && String(p.username).toLowerCase() === username)
      return Promise.resolve({ data: available, error: null })
    }

    if (name === 'complete_onboarding') {
      const profile = store.profiles.find(p => p.id === currentUserId)
      if (!profile) return Promise.resolve({ data: null, error: { message: 'Profile not found' } })
      if (profile.onboarding_completed) {
        return Promise.resolve({ data: null, error: { message: 'Onboarding has already been completed' } })
      }
      Object.assign(profile, {
        username: args.p_username,
        onboarding_completed: true,
        looking_for: args.p_looking_for,
        preferred_cities: args.p_preferred_cities,
      })
      return Promise.resolve({ data: null, error: null })
    }

    if (name === 'get_my_contribution_drafts') {
      return Promise.resolve({ data: store.contribution_drafts.filter(draft => draft.user_id === currentUserId), error: null })
    }

    if (name === 'save_contribution_draft') {
      const id = args?.p_draft_id || uid()
      const existing = store.contribution_drafts.find(draft => draft.id === id && draft.user_id === currentUserId)
      const row = {
        id,
        user_id: currentUserId,
        draft_type: args.p_draft_type,
        payload: args.p_payload,
        product_id: args.p_product_id,
        store_id: args.p_store_id,
        product_suggestion_id: existing?.product_suggestion_id ?? null,
        store_suggestion_id: existing?.store_suggestion_id ?? null,
        state: existing?.state ?? 'editing',
        updated_at: new Date().toISOString(),
      }
      if (existing) Object.assign(existing, row)
      else store.contribution_drafts.push(row)
      return Promise.resolve({ data: id, error: null })
    }

    if (name === 'discard_contribution_draft') {
      store.contribution_drafts = store.contribution_drafts.filter(draft => !(draft.id === args.p_draft_id && draft.user_id === currentUserId))
      return Promise.resolve({ data: null, error: null })
    }

    if (name === 'suggest_product_for_draft' || name === 'suggest_store_for_draft') {
      const draftId = args?.p_draft_id || uid()
      const suggestionId = uid()
      const suggestionTable = name === 'suggest_product_for_draft' ? store.product_suggestions : store.store_suggestions
      suggestionTable.push({
        id: suggestionId,
        user_id: currentUserId,
        name: args.p_name,
        retailer_name: args.p_retailer_name,
        store_name: args.p_store_name,
        address_line1: args.p_address_line1,
        city: args.p_city,
        state: args.p_state,
        zip_code: args.p_zip_code,
        source_url: args.p_source_url ?? args.p_website_url,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      const existing = store.contribution_drafts.find(draft => draft.id === draftId)
      const draft = existing ?? { id: draftId, user_id: currentUserId }
      Object.assign(draft, {
        draft_type: args.p_draft_type,
        payload: args.p_payload,
        product_id: null,
        store_id: null,
        product_suggestion_id: name === 'suggest_product_for_draft' ? suggestionId : existing?.product_suggestion_id ?? null,
        store_suggestion_id: name === 'suggest_store_for_draft' ? suggestionId : existing?.store_suggestion_id ?? null,
        state: 'waiting_for_approval',
        updated_at: new Date().toISOString(),
      })
      if (!existing) store.contribution_drafts.push(draft)
      return Promise.resolve({ data: [{ draft_id: draftId, suggestion_id: suggestionId }], error: null })
    }

    if (name === 'create_sighting') {
      const location = store.stores.find(item => item.id === args.p_store_id)
      const id = uid()
      store.sightings.push({
        id,
        user_id: currentUserId,
        product_id: args.p_product_id,
        store_id: args.p_store_id,
        store_name: location?.store_name ?? 'Unknown store',
        city: location?.city ?? null,
        state: location?.state ?? null,
        zip_code: location?.zip_code ?? null,
        availability: args.p_availability,
        stock_level: args.p_availability === 'low_stock' ? 'low' : args.p_availability === 'sold_out' || args.p_availability === 'unknown' ? 'none' : 'in_stock',
        quantity: args.p_quantity,
        notes: args.p_notes,
        seen_at: args.p_seen_at,
        is_public: false,
        bounty_id: null,
        moderation_status: 'pending',
        created_at: new Date().toISOString(),
      })
      if (args.p_draft_id) store.contribution_drafts = store.contribution_drafts.filter(draft => draft.id !== args.p_draft_id)
      return Promise.resolve({ data: id, error: null })
    }

    if (name === 'create_bounty') {
      const id = uid()
      store.bounties.push({
        id,
        user_id: currentUserId,
        product_id: args.p_product_id,
        scope_type: args.p_scope_type ?? 'region',
        store_id: args.p_store_id,
        reward_cents: args.p_reward_cents,
        zip_code: args.p_zip_code,
        radius_miles: args.p_radius_miles,
        requirements: args.p_requirements,
        quantity_needed: args.p_quantity_needed ?? null,
        variant_requirements: args.p_variant_requirements ?? null,
        accept_equivalent: args.p_accept_equivalent ?? false,
        deadline: args.p_deadline,
        status: 'open',
        moderation_status: 'pending',
        created_at: new Date().toISOString(),
      })
      if (args.p_draft_id) store.contribution_drafts = store.contribution_drafts.filter(draft => draft.id !== args.p_draft_id)
      return Promise.resolve({ data: id, error: null })
    }

    if (name === 'search_retailers') {
      const q = (args.p_query ?? '').toLowerCase().trim()
      const results = store.retailers.filter((r: any) => r.is_active && (q === '' || r.name.toLowerCase().includes(q))).slice(0, 12)
      return Promise.resolve({ data: results, error: null })
    }

    if (name === 'get_bounty_detail') {
      const bounty = store.bounties.find(item => item.id === args.p_bounty_id)
      if (!bounty) return Promise.resolve({ data: [], error: null })
      const product = store.products.find(item => item.id === bounty.product_id)
      const location = store.stores.find(item => item.id === bounty.store_id)
      const profile = store.profiles.find(item => item.id === bounty.user_id)
      const callerClaim = store.bounty_claims.find(item => item.bounty_id === bounty.id && item.finder_id === currentUserId)
      return Promise.resolve({ data: [{
        ...bounty,
        product_name: product?.name ?? 'Unknown product',
        product_slug: product?.slug ?? '',
        store_name: location?.store_name ?? null,
        owner_username: profile?.username ?? 'member',
        is_owner: bounty.user_id === currentUserId,
        caller_claim_id: callerClaim?.id ?? null,
        caller_claim_status: callerClaim?.status ?? null,
        owner_contact_info: null,
        accepted_finder_contact_info: null,
        scope_type: bounty.scope_type ?? 'region',
        quantity_needed: bounty.quantity_needed ?? null,
        variant_requirements: bounty.variant_requirements ?? null,
        accept_equivalent: bounty.accept_equivalent ?? false,
      }], error: null })
    }

    if (name === 'list_my_bounty_claims') {
      const bounty = store.bounties.find(item => item.id === args.p_bounty_id)
      const rows = store.bounty_claims
        .filter(claim => claim.bounty_id === args.p_bounty_id && (bounty?.user_id === currentUserId || claim.finder_id === currentUserId))
        .map(claim => {
          const sighting = store.sightings.find(item => item.id === claim.sighting_id)
          const profile = store.profiles.find(item => item.id === claim.finder_id)
          return { ...claim, finder_username: profile?.username ?? 'member', store_id: sighting?.store_id, store_name: sighting?.store_name, seen_at: sighting?.seen_at, availability: sighting?.availability, quantity: sighting?.quantity, notes: sighting?.notes, contact_info: null }
        })
      return Promise.resolve({ data: rows, error: null })
    }

    if (name.startsWith('admin_list_')) {
      if (currentUserId !== 'u1') return Promise.resolve({ data: null, error: { message: 'Owner access required' } })
      if (name === 'admin_list_product_suggestions') return Promise.resolve({ data: store.product_suggestions, error: null })
      if (name === 'admin_list_store_suggestions') return Promise.resolve({ data: store.store_suggestions, error: null })
      if (name === 'admin_list_interest_events') return Promise.resolve({ data: store.interest_events, error: null })
      if (name === 'admin_list_member_restrictions') return Promise.resolve({ data: store.member_restrictions, error: null })
      if (name === 'admin_list_moderation_history') return Promise.resolve({ data: store.moderation_events, error: null })
      if (name === 'admin_list_recent_contributions') return Promise.resolve({ data: [], error: null })
    }

    if (name === 'admin_resolve_product_suggestion' || name === 'admin_resolve_store_suggestion') {
      const suggestionTable = name.includes('product') ? store.product_suggestions : store.store_suggestions
      const suggestion = suggestionTable.find(item => item.id === args.p_suggestion_id)
      if (suggestion) suggestion.status = args.p_decision
      return Promise.resolve({ data: args.p_canonical_id ?? uid(), error: null })
    }

    if (name === 'admin_set_contribution_moderation' || name === 'admin_set_member_restriction') {
      return Promise.resolve({ data: null, error: null })
    }

    if (name === 'admin_create_store') {
      const id = uid()
      store.stores.push({ id, retailer_id: uid(), name: args.p_store_name, slug: args.p_store_name.toLowerCase().replace(/\s+/g, '-'), address_line1: args.p_address_line1, city: args.p_city, state: args.p_state, zip_code: args.p_zip_code, is_active: true, store_name: args.p_store_name, retailer_name: args.p_retailer_name, phone: args.p_phone ?? null, website_url: args.p_website_url ?? null } as any)
      return Promise.resolve({ data: id, error: null })
    }
    if (name === 'admin_update_store' || name === 'admin_disable_store') {
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'admin_create_product') {
      const id = uid()
      store.products.push({ id, trend_id: args.p_trend_id, name: args.p_name, slug: args.p_name.toLowerCase().replace(/\s+/g, '-'), availability_status: args.p_availability_status, is_active: true, source_url: args.p_source_url ?? null, retailer: args.p_retailer ?? null, release_date: args.p_release_date ?? null, verified_at: null, created_at: new Date().toISOString() } as any)
      return Promise.resolve({ data: id, error: null })
    }
    if (name === 'admin_update_product' || name === 'admin_disable_product') {
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'admin_search_members') {
      const q = (args.p_query ?? '').toLowerCase().trim()
      const results = store.profiles.filter((p: any) => q === '' || (p.username ?? '').toLowerCase().includes(q)).slice(0, 20).map((p: any) => ({ user_id: p.id, username: p.username, karma: p.karma ?? 0, created_at: p.created_at }))
      return Promise.resolve({ data: results, error: null })
    }

    if (name === 'submit_bounty_claim') {
      const bounty = store.bounties.find(b => b.id === args.p_bounty_id)
      if (!bounty || bounty.status !== 'open') {
        return Promise.resolve({ data: null, error: { message: 'Bounty is not open' } })
      }
      if (bounty.user_id === currentUserId) {
        return Promise.resolve({ data: null, error: { message: 'You cannot claim your own bounty' } })
      }
      const canonicalStore = store.stores.find(location => location.id === args.p_store_id)
      const sighting = {
        id: uid(),
        user_id: currentUserId,
        product_id: bounty.product_id,
        store_id: canonicalStore?.id ?? null,
        store_name: canonicalStore?.store_name ?? args.p_store_name,
        city: canonicalStore?.city ?? args.p_city,
        state: canonicalStore?.state ?? args.p_state,
        zip_code: canonicalStore?.zip_code ?? args.p_zip_code,
        stock_level: args.p_availability === 'low_stock' || args.p_availability === 'low' || args.p_stock_level === 'low' ? 'low' : args.p_availability === 'sold_out' || args.p_availability === 'unknown' ? 'none' : 'in_stock',
        availability: args.p_availability ?? 'in_stock',
        quantity: args.p_quantity ?? null,
        notes: args.p_notes ?? null,
        seen_at: args.p_seen_at ?? new Date().toISOString(),
        moderation_status: 'approved',
        is_public: false,
        bounty_id: bounty.id,
        photo_urls: null,
        created_at: new Date().toISOString(),
      }
      store.sightings.push(sighting)
      const claim = {
        id: uid(),
        bounty_id: bounty.id,
        finder_id: currentUserId,
        sighting_id: sighting.id,
        status: 'pending',
        created_at: new Date().toISOString(),
      }
      store.bounty_claims.push(claim)
      return Promise.resolve({ data: claim.id, error: null })
    }

    if (name === 'accept_bounty_claim' || name === 'reject_bounty_claim') {
      const claim = store.bounty_claims.find(c => c.id === args.p_claim_id)
      const bounty = claim && store.bounties.find(b => b.id === claim.bounty_id)
      if (!claim || !bounty) {
        return Promise.resolve({ data: null, error: { message: 'Claim not found' } })
      }
      if (bounty.user_id !== currentUserId) {
        return Promise.resolve({ data: null, error: { message: 'Only the bounty owner can update this claim' } })
      }
      if (name === 'accept_bounty_claim') {
        claim.status = 'accepted'
        bounty.status = 'claimed'
        store.bounty_claims.forEach(c => {
          if (c.bounty_id === bounty.id && c.id !== claim.id && c.status === 'pending') c.status = 'rejected'
        })
        const finder = store.profiles.find(p => p.id === claim.finder_id)
        if (finder) finder.karma += 1
      } else {
        claim.status = 'rejected'
      }
      return Promise.resolve({ data: null, error: null })
    }

    if (name === 'close_bounty') {
      const bounty = store.bounties.find(b => b.id === args.p_bounty_id)
      if (!bounty) return Promise.resolve({ data: null, error: { message: 'Bounty not found' } })
      if (bounty.user_id !== currentUserId) {
        return Promise.resolve({ data: null, error: { message: 'Only the bounty owner can close this bounty' } })
      }
      bounty.status = 'closed'
      store.bounty_claims.forEach(c => {
        if (c.bounty_id === bounty.id && c.status === 'pending') c.status = 'rejected'
      })
      return Promise.resolve({ data: null, error: null })
    }

    return Promise.resolve({ data: null, error: { message: `Unknown RPC: ${name}` } })
  },
  auth: {
    getSession: () => Promise.resolve({ data: { session: mockSession }, error: null }),
    signUp: ({ email, options }: any) => {
      const id = uid()
      const username = options?.data?.username || `user_${id.replace(/-/g, '').slice(0, 15)}`
      store.profiles.push({
        id,
        username,
        karma: 0,
        is_pro: false,
        onboarding_completed: false,
        looking_for: null,
        preferred_cities: [],
        created_at: new Date().toISOString(),
      })
      mockSession = { user: { id, email }, access_token: 'mock' }
      listeners.forEach(l => l('SIGNED_IN', mockSession))
      return Promise.resolve({ data: { user: { id, email }, session: mockSession }, error: null })
    },
    signInWithPassword: ({ email }: any) => {
      const id = email.includes('poster') ? 'u2' : 'u1'
      mockSession = { user: { id, email }, access_token: 'mock' }
      listeners.forEach(l => l('SIGNED_IN', mockSession))
      return Promise.resolve({ data: { user: mockSession.user, session: mockSession }, error: null })
    },
    signOut: () => {
      mockSession = null
      listeners.forEach(l => l('SIGNED_OUT', null))
      return Promise.resolve({ error: null })
    },
    onAuthStateChange: (cb: (e: string, s: any) => void) => {
      listeners.push(cb)
      return { data: { subscription: { unsubscribe: () => {} } } }
    },
    refreshSession: () => Promise.resolve({ data: { session: mockSession }, error: null }),
    getUser: () => Promise.resolve({ data: { user: mockSession?.user ?? null }, error: null }),
  },
}
