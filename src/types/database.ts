export type Trend = {
  id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  created_at: string
}

export type Product = {
  id: string
  trend_id: string
  name: string
  slug: string
  created_at: string
  trend?: Trend
}

export type Profile = {
  id: string
  username: string
  contact_info: string | null
  karma: number
  is_pro: boolean
  created_at: string
}

export type Bounty = {
  id: string
  user_id: string
  product_id: string
  reward_amount: number
  zip_code: string
  radius_miles: number
  notes: string | null
  status: 'open' | 'claimed' | 'closed'
  created_at: string
  product?: Product
  profile?: Profile
  distance_miles?: number
}

export type Sighting = {
  id: string
  user_id: string
  product_id: string
  store_name: string
  city: string | null
  state: string | null
  zip_code: string | null
  stock_level: 'in_stock' | 'low' | 'none'
  is_public: boolean
  bounty_id: string | null
  photo_urls: string[] | null
  created_at: string
  product?: Product
  profile?: Profile
  distance_miles?: number
}

export type BountyClaim = {
  id: string
  bounty_id: string
  finder_id: string
  sighting_id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  sighting?: Sighting
  finder?: Profile
}
