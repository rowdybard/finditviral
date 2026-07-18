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
  image_url?: string | null
  image_source_url?: string | null
  image_license?: string | null
  image_attribution?: string | null
  is_active: boolean
  created_at: string
  trend?: Trend
  has_sightings?: boolean
}

export type PublicProduct = {
  id: string
  name: string
  slug: string
  trend_id: string
  trend_name: string | null
  trend_slug: string | null
  availability_status: Product['availability_status']
  release_date: string | null
  retailer: string | null
  source_url: string | null
  image_url: string | null
  image_attribution: string | null
  latest_seen_at: string | null
  approved_sighting_count: number
  open_bounty_count: number
}

export type ProductSearchResult = {
  id: string
  name: string
  slug: string
  trend_name: string | null
  availability_status: Product['availability_status']
  release_date: string | null
  image_url: string | null
}

export type Store = {
  id: string
  slug: string
  retailer_name: string
  store_name: string
  address_line1: string
  address_line2?: string | null
  city: string
  state: string
  zip_code: string
  phone?: string | null
  website_url?: string | null
  latitude?: number | null
  longitude?: number | null
  is_active?: boolean
  latest_seen_at?: string | null
  approved_sighting_count?: number
}

export type StoreSearchResult = Pick<
  Store,
  'id' | 'slug' | 'retailer_name' | 'store_name' | 'address_line1' | 'city' | 'state' | 'zip_code'
>

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

export type BountyScope = 'region' | 'retailers' | 'stores'

export type Bounty = {
  id: string
  user_id?: string
  product_id: string
  product_name?: string
  product_slug?: string
  reward_amount?: number
  reward_cents?: number
  scope_type?: BountyScope
  store_id?: string | null
  store?: Store | null
  store_slug?: string | null
  store_name?: string | null
  retailer_name?: string | null
  zip_code: string | null
  radius_miles: number | null
  notes?: string | null
  requirements?: string | null
  quantity_needed?: number | null
  variant_requirements?: string | null
  accept_equivalent?: boolean
  retailer_names?: string[] | null
  store_names?: string[] | null
  deadline?: string | null
  moderation_status?: 'pending' | 'approved' | 'rejected' | 'hidden' | null
  is_owner?: boolean
  status: 'open' | 'claimed' | 'closed'
  created_at: string
  product?: Product
  profile?: Profile
  distance_miles?: number
}

export type Sighting = {
  id: string
  user_id?: string
  product_id: string
  product_name?: string
  product_slug?: string
  store_id?: string
  store_slug?: string
  retailer_name?: string
  store?: Store
  store_name: string
  city: string | null
  state: string | null
  zip_code: string | null
  stock_level?: 'in_stock' | 'low' | 'none'
  availability?: 'in_stock' | 'low_stock' | 'sold_out' | 'unknown'
  quantity?: number | null
  notes?: string | null
  seen_at?: string
  moderation_status?: 'pending' | 'approved' | 'rejected' | 'hidden'
  is_public?: boolean
  bounty_id?: string | null
  lead_id?: string | null
  photo_urls?: string[] | null
  created_at: string
  product?: Product
  profile?: Profile
  distance_miles?: number
  freshness_status?: 'fresh' | 'possibly_outdated' | 'expired'
  verified_count?: number
  not_found_count?: number
  last_verified_at?: string | null
  last_not_found_at?: string | null
  viewer_response?: SightingVerificationResponse | null
  community_state?: SightingCommunityState
  is_owner?: boolean
  edited_at?: string | null
}

export type SightingVerificationResponse = 'verified' | 'not_found'
export type SightingCommunityState =
  | 'unverified'
  | 'community_verified'
  | 'disputed'
  | 'not_found_reported'
  | 'possibly_gone'

export type SightingVerificationSummary = {
  sighting_id: string
  verified_count: number
  not_found_count: number
  last_verified_at: string | null
  last_not_found_at: string | null
  viewer_response: SightingVerificationResponse | null
  community_state: SightingCommunityState
  is_owner: boolean
}

export type SightingSubmissionResult = {
  sighting_ids: string[]
  moderation_status: 'approved' | 'pending'
  is_public: boolean
  replayed: boolean
}

export type ContributionDraftType = 'sighting' | 'bounty'
export type ContributionDraftState = 'editing' | 'waiting_for_approval' | 'ready' | 'needs_attention'

export type ContributionDraft = {
  id: string
  draft_type: ContributionDraftType
  payload: Record<string, unknown>
  product_id: string | null
  store_id: string | null
  product_suggestion_id: string | null
  store_suggestion_id: string | null
  state: ContributionDraftState
  updated_at: string
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'duplicate'

export type CatalogSuggestion = {
  id: string
  user_id?: string
  name?: string | null
  brand?: string | null
  product_name?: string | null
  retailer_name?: string | null
  store_name?: string | null
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  phone?: string | null
  source_url?: string | null
  status: SuggestionStatus
  canonical_product_id?: string | null
  canonical_store_id?: string | null
  created_at: string
  reviewed_at?: string | null
  review_reason?: string | null
}

export type InterestEvent = {
  id: string
  source: string
  email?: string | null
  reason?: string | null
  looking_for?: string | null
  username?: string | null
  digest_status?: string | null
  created_at: string
}

export type AdminContribution = {
  contribution_type: 'sighting' | 'bounty' | 'lead'
  contribution_id: string
  username: string | null
  product_name: string
  moderation_status: 'pending' | 'approved' | 'rejected' | 'hidden'
  lifecycle_status: string | null
  occurred_at: string
  verified_count?: number
  not_found_count?: number
  community_state?: SightingCommunityState | null
  moderation_flagged?: boolean
  moderation_categories?: string[]
}

export type AdminReviewCounts = {
  pending_product_suggestions: number
  pending_store_suggestions: number
  pending_sightings: number
  pending_bounties: number
  pending_leads: number
  total: number
}

export type ModerationEvent = {
  id: string
  contribution_type: 'sighting' | 'bounty' | 'lead'
  contribution_id: string
  actor_id: string
  previous_status: string | null
  new_status: string
  reason: string | null
  created_at: string
}

export type MemberRestriction = {
  user_id: string
  username: string | null
  status: 'suspended' | 'disabled'
  reason: string | null
  expires_at: string | null
  created_at: string
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

export type BountyDetailView = {
  id: string
  product_id: string
  product_name: string
  product_slug: string
  store_id: string | null
  store_name: string | null
  zip_code: string | null
  radius_miles: number | null
  reward_cents: number
  deadline: string
  requirements: string | null
  quantity_needed: number | null
  variant_requirements: string | null
  accept_equivalent: boolean
  scope_type: 'region' | 'retailers' | 'stores'
  retailer_names: string[] | null
  store_names: string[] | null
  status: 'open' | 'claimed' | 'closed'
  moderation_status: 'pending' | 'approved' | 'rejected' | 'hidden' | null
  created_at: string
  owner_username: string
  is_owner: boolean
  caller_claim_id: string | null
  caller_claim_status: 'pending' | 'accepted' | 'rejected' | null
  owner_contact_info: string | null
  accepted_finder_contact_info: string | null
}

export type MyClaimView = {
  id: string
  bounty_id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  product_name: string
  product_slug: string
}

export type BountyClaimView = {
  id: string
  finder_id: string
  finder_username: string
  status: 'pending' | 'accepted' | 'rejected'
  sighting_id: string
  store_id: string
  store_name: string
  seen_at: string
  availability: 'in_stock' | 'low_stock'
  quantity: number | null
  notes: string | null
  contact_info: string | null
  created_at: string
}

export type PersonalNotification = {
  id: string
  event_type: string
  title: string
  subtitle: string
  link: string
  occurred_at: string
}

export type RetailerSearchResult = {
  id: string
  name: string
  slug: string
  website_url: string | null
}

export type AdminMemberSearchResult = {
  user_id: string
  username: string
  karma: number
  created_at: string
}

export type AdminProduct = {
  id: string
  name: string
  slug: string
  trend_name: string
  brand: string | null
  category: string | null
  availability_status: string
  release_date: string | null
  is_active: boolean
  search_terms: string | null
}

export type AdminStore = {
  id: string
  name: string
  slug: string
  retailer_name: string
  address_line1: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  is_active: boolean
}

export type LeadSourceType = 'employee_tip' | 'social_media' | 'press_release' | 'restock_schedule' | 'other'
export type LeadStatus = 'pending' | 'active' | 'confirmed' | 'expired' | 'hidden'
export type LeadScope = 'region' | 'stores'

export type Lead = {
  id: string
  product_id: string
  product_name?: string
  product_slug?: string
  slug: string
  headline: string
  details: string | null
  expected_date: string | null
  scope_type: LeadScope
  store_id: string | null
  store_name?: string | null
  store_slug?: string | null
  zip_code: string | null
  radius_miles: number | null
  source_type: LeadSourceType
  source_url: string | null
  status: LeadStatus
  confirmed_sighting_id: string | null
  expires_at: string
  created_at: string
  username?: string | null
  credible_count?: number
  doubtful_count?: number
  net_score?: number
  distance_miles?: number | null
  is_owner?: boolean
  edited_at?: string | null
}

export type LeadDetailView = {
  id: string
  product_id: string
  product_name: string
  product_slug: string
  slug: string
  headline: string
  details: string | null
  expected_date: string | null
  scope_type: LeadScope
  store_id: string | null
  store_name: string | null
  store_slug: string | null
  store_city: string | null
  store_state: string | null
  zip_code: string | null
  radius_miles: number | null
  source_type: LeadSourceType
  source_url: string | null
  status: LeadStatus
  confirmed_sighting_id: string | null
  confirmed_store_name: string | null
  confirmed_seen_at: string | null
  expires_at: string
  created_at: string
  username: string | null
  is_owner: boolean
  caller_vote: 'credible' | 'doubtful' | null
  credible_count: number
  doubtful_count: number
  net_score: number
  edited_at?: string | null
}
