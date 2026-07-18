const fs = require('fs');
const f = 'c:/Users/maxpu/CascadeProjects/finditviral/src/pages/BountyDetail.tsx';
let c = fs.readFileSync(f, 'utf8');
const hasCRLF = c.includes('\r\n');
if (hasCRLF) c = c.replace(/\r\n/g, '\n');

const old1 = `{bounty.moderation_status !== 'approved' && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">This bounty is {bounty.moderation_status}. New claims are disabled.</div>
      )}`;

const new1 = `{bounty.is_owner && bounty.moderation_status && bounty.moderation_status !== 'approved' && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">This bounty is {bounty.moderation_status}. New claims are disabled.</div>
      )}`;

if (c.includes(old1)) {
  c = c.replace(old1, new1);
  console.log('banner guarded');
} else {
  console.log('ERROR: banner not found');
}

if (hasCRLF) c = c.replace(/\n/g, '\r\n');
fs.writeFileSync(f, c, 'utf8');
