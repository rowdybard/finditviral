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
  availability_status: 'available' | 'backorder' | 'preorder' | 'announced' | 'limited' | 'retired'
  source_url: string | null
  retailer: string | null
  release_date: string | null
  verified_at: string | null
  is_active: boolean
  created_at: string
  trend?: Trend
}

export type Profile = {
  id: string
  username: string
  karma: number
  is_pro: boolean
  created_at: string
  onboarding_completed?: boolean
  referred_by?: string | null
  referral_count?: number
  looking_for?: string | null
  preferred_cities?: string[] | null
}

export type ProfileContact = {
  user_id: string
  contact_info: string | null
  created_at: string
  updated_at: string
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
  bounty?: Bounty
  sighting?: Sighting
  finder?: Profile
}
