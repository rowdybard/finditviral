const fs = require('fs');
const f = 'c:/Users/maxpu/CascadeProjects/finditviral/src/pages/Profile.tsx';
let c = fs.readFileSync(f, 'utf8');

// Helper: normalize \r\n to \n for matching, then restore
const hasCRLF = c.includes('\r\n');
if (hasCRLF) c = c.replace(/\r\n/g, '\n');

// 1. Update imports: add listMyBounties, listMyClaims to launchApi import
c = c.replace(
  "import { getMyContributionDrafts, deleteBounty, deleteSighting } from '../lib/launchApi'",
  "import { getMyContributionDrafts, deleteBounty, deleteSighting, listMyBounties, listMyClaims } from '../lib/launchApi'"
);
console.log('imports updated');

// 2. Update type import: add MyClaimView, remove BountyClaim
c = c.replace(
  "import type { Profile, ProfileContact, Bounty, Sighting, BountyClaim } from '../types/database'",
  "import type { Profile, ProfileContact, Bounty, Sighting, MyClaimView } from '../types/database'"
);
console.log('type import updated');

// 3. Change claims state type from BountyClaim[] to MyClaimView[]
c = c.replace(
  "const [claims, setClaims] = useState<BountyClaim[]>",
  "const [claims, setClaims] = useState<MyClaimView[]>"
);
console.log('claims state type updated');

// 4. Replace the bounties query with RPC call
const oldBountiesQuery = `      const [bountiesRes, sightingsRes, claimsRes, contributionDraftsRes] = await Promise.all([
        supabase
          .from('bounties')
          .select('id,user_id,product_id,reward_amount,reward_cents,store_id,zip_code,radius_miles,notes,requirements,deadline,status,moderation_status,created_at,product:products(*)')
          .eq('user_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('sightings')`;
const newBountiesQuery = `      const [bountiesRes, sightingsRes, claimsRes, contributionDraftsRes] = await Promise.all([
        listMyBounties(20),
        supabase
          .from('sightings')`;
if (c.includes(oldBountiesQuery)) {
  c = c.replace(oldBountiesQuery, newBountiesQuery);
  console.log('bounties query replaced');
} else {
  console.log('ERROR: bounties query block not found');
}

// 5. Replace the bounty_claims query with RPC call
const oldClaimsQuery = `        supabase
          .from('bounty_claims')
          .select('id,bounty_id,finder_id,sighting_id,status,created_at,bounty:bounties(id,product_id,status,product:products(*))')
          .eq('finder_id', profileData.id)
          .order('created_at', { ascending: false })
          .limit(20),
        getMyContributionDrafts(),`;
const newClaimsQuery = `        listMyClaims(20),
        getMyContributionDrafts(),`;
if (c.includes(oldClaimsQuery)) {
  c = c.replace(oldClaimsQuery, newClaimsQuery);
  console.log('claims query replaced');
} else {
  console.log('ERROR: claims query block not found');
}

// 6. Replace bounty data mapping (RPC returns flat data, no nested product array)
const oldBountyMap = `      const bountyRows = (bountiesRes.data ?? []).map((row) => ({
        ...row,
        product: Array.isArray(row.product) ? row.product[0] : row.product,
      }))`;
const newBountyMap = `      const bountyRows = (bountiesRes.data ?? []) as unknown as Bounty[]`;
if (c.includes(oldBountyMap)) {
  c = c.replace(oldBountyMap, newBountyMap);
  console.log('bounty mapping replaced');
} else {
  console.log('ERROR: bounty mapping not found');
}

// 7. Replace claim data mapping and setBounties/setClaims calls
const oldClaimMap = `      const claimRows = (claimsRes.data ?? []).map((row) => {
        const bounty = Array.isArray(row.bounty) ? row.bounty[0] : row.bounty
        return {
          ...row,
          bounty: bounty
            ? {
                ...bounty,
                product: Array.isArray(bounty.product) ? bounty.product[0] : bounty.product,
              }
            : undefined,
        }
      })
      setBounties(bountyRows as unknown as Bounty[])
      setSightings(sightingRows as unknown as Sighting[])
      setClaims(claimRows as unknown as BountyClaim[])`;
const newClaimMap = `      setBounties(bountyRows)
      setSightings(sightingRows as unknown as Sighting[])
      setClaims((claimsRes.data ?? []) as MyClaimView[])`;
if (c.includes(oldClaimMap)) {
  c = c.replace(oldClaimMap, newClaimMap);
  console.log('claim mapping replaced');
} else {
  console.log('ERROR: claim mapping not found');
}

// 8. Update claims rendering: use c.product_name instead of c.bounty?.product?.name
c = c.replace(
  "{c.bounty?.product?.name ?? 'Unknown product'}",
  "{c.product_name ?? 'Unknown product'}"
);
console.log('claim render updated');

// Restore CRLF if needed
if (hasCRLF) c = c.replace(/\n/g, '\r\n');

fs.writeFileSync(f, c, 'utf8');
console.log('Profile.tsx saved');
