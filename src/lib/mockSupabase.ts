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
          ? { status: 'open' }
          : this.t === 'sightings'
            ? { stock_level: 'in_stock', is_public: true, bounty_id: null, photo_urls: null }
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
    const currentUserId = mockSession?.user?.id
    if (!currentUserId) {
      return Promise.resolve({ data: null, error: { message: 'Authentication required' } })
    }

    if (name === 'submit_bounty_claim') {
      const bounty = store.bounties.find(b => b.id === args.p_bounty_id)
      if (!bounty || bounty.status !== 'open') {
        return Promise.resolve({ data: null, error: { message: 'Bounty is not open' } })
      }
      if (bounty.user_id === currentUserId) {
        return Promise.resolve({ data: null, error: { message: 'You cannot claim your own bounty' } })
      }
      const sighting = {
        id: uid(),
        user_id: currentUserId,
        product_id: bounty.product_id,
        store_name: args.p_store_name,
        city: args.p_city,
        state: args.p_state,
        zip_code: args.p_zip_code,
        stock_level: args.p_stock_level || 'in_stock',
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
      const username = options?.data?.username || 'DemoUser'
      store.profiles.push({ id, username, karma: 0, is_pro: false, created_at: new Date().toISOString() })
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
