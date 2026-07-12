export type MarketConfig = {
  name: string
  state: string
  stateName: string
  cities: string[]
  defaultZip: string
  betaLabel: string
  seoTitle: string
  seoDescription: string
  storeExamples: string[]
  storePlaceholder: string
  trustNotice: string
  onboardingHelp: string
  onboardingLocationHelp: string
  footerTagline: string
}

export const activeMarket: MarketConfig = {
  name: 'Greater Lansing',
  state: 'MI',
  stateName: 'Michigan',
  cities: [
    'Lansing',
    'East Lansing',
    'Okemos',
    'Haslett',
    'Holt',
    'Delta Township',
    'Waverly',
    'DeWitt',
    'Grand Ledge',
    'Mason',
  ],
  defaultZip: '48910',
  betaLabel: 'Greater Lansing Beta',
  seoTitle: 'FindItViral | Find Viral Products Around Greater Lansing',
  seoDescription:
    'Find recent community-reported sightings for viral and hard-to-find products around Lansing, East Lansing, Okemos, Holt, and nearby communities.',
  storeExamples: [
    'Meijer',
    'Target',
    'Walmart',
    'Five Below',
    'Costco',
    "Sam's Club",
    'Kroger',
    'Walgreens',
    'CVS',
  ],
  storePlaceholder: 'Meijer, Target, Walmart, Five Below...',
  trustNotice:
    'Sightings are community reported and inventory can change quickly. Confirm availability with the store before making a long trip.',
  onboardingHelp:
    'We use your location to show sightings and bounties nearby.',
  onboardingLocationHelp:
    "Enter your ZIP and we'll show you what's nearby.",
  footerTagline: 'Greater Lansing Beta',
}

export function citySuggestions(): string[] {
  return activeMarket.cities
}
