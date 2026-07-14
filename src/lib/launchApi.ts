import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type {
  Bounty,
  BountyClaimView,
  BountyDetailView,
  AdminContribution,
  CatalogSuggestion,
  ContributionDraft,
  ContributionDraftType,
  InterestEvent,
  MemberRestriction,
  ModerationEvent,
  PublicProduct,
  ProductSearchResult,
  Sighting,
  Store,
  StoreSearchResult,
} from '../types/database'

type RpcResult<T> = Promise<{ data: T | null; error: PostgrestError | null }>

async function callRpc<T>(name: string, args?: Record<string, unknown>): RpcResult<T> {
  const result = await supabase.rpc(name, args)
  return { data: result.data as T | null, error: result.error }
}

function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data
}

export async function searchProducts(query: string): RpcResult<ProductSearchResult[]> {
  return callRpc<ProductSearchResult[]>('search_products', {
    p_query: query.trim(),
    p_limit: 12,
  })
}

export async function searchStores(query: string): RpcResult<StoreSearchResult[]> {
  return callRpc<StoreSearchResult[]>('search_stores', {
    p_query: query.trim(),
    p_limit: 12,
  })
}

export async function getMyContributionDrafts(): RpcResult<ContributionDraft[]> {
  return callRpc<ContributionDraft[]>('get_my_contribution_drafts')
}

export async function saveContributionDraft(input: {
  id: string | null
  type: ContributionDraftType
  payload: Record<string, unknown>
  productId: string | null
  storeId: string | null
}): RpcResult<string> {
  return callRpc<string>('save_contribution_draft', {
    p_draft_id: input.id,
    p_draft_type: input.type,
    p_payload: input.payload,
    p_product_id: input.productId,
    p_store_id: input.storeId,
  })
}

export async function discardContributionDraft(id: string): RpcResult<null> {
  return callRpc<null>('discard_contribution_draft', { p_draft_id: id })
}

export type SuggestionDraftResult = { draft_id: string; suggestion_id: string }

export async function suggestProductForDraft(input: {
  draftId: string | null
  type: ContributionDraftType
  payload: Record<string, unknown>
  name: string
  brand: string | null
  sourceUrl: string | null
  storeId: string | null
}): RpcResult<SuggestionDraftResult[]> {
  return callRpc<SuggestionDraftResult[]>('suggest_product_for_draft', {
    p_draft_id: input.draftId,
    p_draft_type: input.type,
    p_payload: input.payload,
    p_name: input.name,
    p_brand: input.brand,
    p_source_url: input.sourceUrl,
    p_store_id: input.storeId,
  })
}

export async function suggestStoreForDraft(input: {
  draftId: string | null
  type: ContributionDraftType
  payload: Record<string, unknown>
  retailerName: string
  storeName: string | null
  addressLine1: string
  city: string
  state: string
  zipCode: string
  phone: string | null
  websiteUrl: string | null
  productId: string | null
}): RpcResult<SuggestionDraftResult[]> {
  return callRpc<SuggestionDraftResult[]>('suggest_store_for_draft', {
    p_draft_id: input.draftId,
    p_draft_type: input.type,
    p_payload: input.payload,
    p_product_id: input.productId,
    p_retailer_name: input.retailerName,
    p_store_name: input.storeName,
    p_address_line1: input.addressLine1,
    p_city: input.city,
    p_state: input.state,
    p_zip_code: input.zipCode,
    p_source_url: input.websiteUrl,
    p_notes: input.phone ? `Phone: ${input.phone}` : null,
  })
}

export async function createSighting(input: {
  productId: string
  storeId: string
  seenAt: string
  availability: 'low' | 'medium' | 'high'
  quantity: number | null
  notes: string | null
  draftId: string | null
}): RpcResult<string> {
  return callRpc<string>('create_sighting', {
    p_product_id: input.productId,
    p_store_id: input.storeId,
    p_seen_at: input.seenAt,
    p_availability: input.availability,
    p_quantity: input.quantity,
    p_notes: input.notes,
    p_draft_id: input.draftId,
  })
}

export async function createBounty(input: {
  productId: string
  storeId: string | null
  zipCode: string | null
  radiusMiles: number | null
  rewardCents: number
  deadline: string
  requirements: string | null
  draftId: string | null
}): RpcResult<string> {
  return callRpc<string>('create_bounty', {
    p_product_id: input.productId,
    p_store_id: input.storeId,
    p_zip_code: input.zipCode,
    p_radius_miles: input.radiusMiles,
    p_reward_cents: input.rewardCents,
    p_deadline: input.deadline,
    p_requirements: input.requirements,
    p_draft_id: input.draftId,
  })
}

export async function getBountyDetail(id: string): RpcResult<BountyDetailView | null> {
  const result = await callRpc<BountyDetailView | BountyDetailView[]>('get_bounty_detail', { p_bounty_id: id })
  return { data: firstRow(result.data), error: result.error }
}

export async function listMyBountyClaims(id: string): RpcResult<BountyClaimView[]> {
  return callRpc<BountyClaimView[]>('list_my_bounty_claims', { p_bounty_id: id })
}

export async function submitBountyClaim(input: {
  bountyId: string
  storeId: string
  seenAt: string
  availability: 'low' | 'medium' | 'high'
  quantity: number | null
  notes: string | null
}): RpcResult<string> {
  return callRpc<string>('submit_bounty_claim', {
    p_bounty_id: input.bountyId,
    p_store_id: input.storeId,
    p_seen_at: input.seenAt,
    p_availability: input.availability,
    p_quantity: input.quantity,
    p_notes: input.notes,
  })
}

export async function getPublicProduct(slug: string): RpcResult<PublicProduct | null> {
  const result = await callRpc<PublicProduct | PublicProduct[]>('get_public_product', { p_slug: slug })
  return { data: firstRow(result.data), error: result.error }
}

export async function listPublicStores(query = '', limit = 50, offset = 0): RpcResult<Store[]> {
  return callRpc<Store[]>('list_public_stores', {
    p_query: query.trim() || null,
    p_limit: limit,
    p_offset: offset,
  })
}

export async function getPublicStore(slug: string): RpcResult<Store | null> {
  const result = await callRpc<Store | Store[]>('get_public_store', { p_slug: slug })
  return { data: firstRow(result.data), error: result.error }
}

export async function listPublicSightings(filters: {
  productId?: string | null
  storeId?: string | null
  limit?: number
  zipCode?: string | null
  radiusMiles?: number | null
} = {}): RpcResult<Sighting[]> {
  return callRpc<Sighting[]>('list_public_sightings', {
    p_product_id: filters.productId ?? null,
    p_store_id: filters.storeId ?? null,
    p_limit: filters.limit ?? 50,
    p_zip_code: filters.zipCode === undefined ? '48910' : filters.zipCode,
    p_radius_miles: filters.radiusMiles === undefined ? 50 : filters.radiusMiles,
  })
}

export async function listPublicBounties(filters: {
  productId?: string | null
  limit?: number
  zipCode?: string | null
  radiusMiles?: number | null
} = {}): RpcResult<Bounty[]> {
  return callRpc<Bounty[]>('list_public_bounties', {
    p_product_id: filters.productId ?? null,
    p_limit: filters.limit ?? 50,
    p_zip_code: filters.zipCode === undefined ? '48910' : filters.zipCode,
    p_radius_miles: filters.radiusMiles === undefined ? 50 : filters.radiusMiles,
  })
}

export async function isAppOwner(): RpcResult<boolean> {
  return callRpc<boolean>('is_app_owner')
}

export async function adminListProductSuggestions(): RpcResult<CatalogSuggestion[]> {
  return callRpc<CatalogSuggestion[]>('admin_list_product_suggestions', { p_status: null, p_limit: 100 })
}

export async function adminListStoreSuggestions(): RpcResult<CatalogSuggestion[]> {
  return callRpc<CatalogSuggestion[]>('admin_list_store_suggestions', { p_status: null, p_limit: 100 })
}

export async function adminResolveProductSuggestion(input: {
  id: string
  decision: 'approved' | 'rejected' | 'duplicate'
  canonicalId: string | null
  reason: string | null
  availabilityStatus: 'available' | 'backorder' | 'preorder' | 'announced' | 'limited' | null
  releaseDate: string | null
}): RpcResult<string> {
  return callRpc<string>('admin_resolve_product_suggestion', {
    p_suggestion_id: input.id,
    p_decision: input.decision,
    p_canonical_id: input.canonicalId,
    p_reason: input.reason,
    p_availability_status: input.availabilityStatus,
    p_release_date: input.releaseDate,
  })
}

export async function adminResolveStoreSuggestion(input: {
  id: string
  decision: 'approved' | 'rejected' | 'duplicate'
  canonicalId: string | null
  reason: string | null
}): RpcResult<string> {
  return callRpc<string>('admin_resolve_store_suggestion', {
    p_suggestion_id: input.id,
    p_decision: input.decision,
    p_canonical_id: input.canonicalId,
    p_reason: input.reason,
  })
}

export async function adminSetContributionModeration(input: {
  kind: 'sighting' | 'bounty'
  id: string
  action: 'hide' | 'restore' | 'reject'
  reason: string | null
}): RpcResult<null> {
  return callRpc<null>('admin_set_contribution_moderation', {
    p_contribution_type: input.kind,
    p_contribution_id: input.id,
    p_action: input.action,
    p_reason: input.reason,
  })
}

export async function adminListInterestEvents(): RpcResult<InterestEvent[]> {
  return callRpc<InterestEvent[]>('admin_list_interest_events')
}

export async function adminListRecentContributions(): RpcResult<AdminContribution[]> {
  return callRpc<AdminContribution[]>('admin_list_recent_contributions', { p_limit: 100 })
}

export async function adminListModerationHistory(): RpcResult<ModerationEvent[]> {
  return callRpc<ModerationEvent[]>('admin_list_moderation_history', { p_limit: 100 })
}

export async function adminListMemberRestrictions(): RpcResult<MemberRestriction[]> {
  return callRpc<MemberRestriction[]>('admin_list_member_restrictions')
}

export async function adminSetMemberRestriction(input: {
  userId: string
  status: 'suspended' | 'disabled' | null
  reason: string | null
  expiresAt: string | null
}): RpcResult<null> {
  return callRpc<null>('admin_set_member_restriction', {
    p_user_id: input.userId,
    p_status: input.status,
    p_reason: input.reason,
    p_expires_at: input.expiresAt,
  })
}
