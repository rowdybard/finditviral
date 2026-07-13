# Listing Card Design QA

## Source

- Selected visual reference: `C:\Users\maxpu\.codex\generated_images\019f4980-90a4-7310-ad66-51758b8bec80\exec-ecad5fc7-5c0f-4c24-9a0a-8d060bc3df7f.png`
- Implementation comparison: `C:\Users\maxpu\CascadeProjects\finditviral\design-qa-comparison.png`
- Desktop bounty state: `C:\Users\maxpu\CascadeProjects\finditviral\design-qa-bounties.png`
- Desktop sighting state: `C:\Users\maxpu\CascadeProjects\finditviral\design-qa-sightings.png`
- Desktop stock-level state: `C:\Users\maxpu\CascadeProjects\finditviral\design-qa-low-stock.png`
- Mobile stock-level state: `C:\Users\maxpu\CascadeProjects\finditviral\design-qa-mobile-stock.png`

## Test state

- Desktop viewport: 1440 x 1024
- Mobile viewport: 390 x 844
- Local development server with the mock owner signed in and onboarding complete
- Listing ZIP filter cleared so seeded HIGH, MEDIUM, and LOW stock states are visible together

## Comparison evidence

- The reference and implementation were placed into one 1440 x 1024 comparison image and inspected together.
- Bounties use the reference's red vertical rail, oversized reward, hard outline, offset black shadow, compact metadata, and visible share action.
- Sightings use the same card anatomy with a stock rail and five-dot availability meter.
- Availability semantics are consistent and unmistakable: HIGH is green, MEDIUM is yellow, and LOW is red.
- The existing application intentionally keeps its one-column `max-w-2xl` listing routes instead of adopting the reference's combined two-column feed. This preserves the established route structure while matching the selected card language.

## Findings and iteration history

1. A broken remote product photo created a visible failed-image artifact. The card now removes failed images and automatically recomputes its layout.
2. The initial desktop MEDIUM label overflowed its stock panel. Its responsive type scale was reduced and rechecked.
3. Offset shadows caused horizontal overflow at the mobile edge. Cards now reserve space for the shadow, and the authenticated navigation wraps into a second row on small screens.
4. The old full-card links could not safely contain a share control. The cards are now semantic articles with sibling navigation and share interactions.
5. Native device sharing is used when available, with a clipboard URL fallback and visible copied/error feedback.

## Result

The listing cards match the chosen high-contrast adult toy-store direction, preserve usable hierarchy at desktop and mobile widths, and expose all required stock states without clipping or overflow.

final result: passed
