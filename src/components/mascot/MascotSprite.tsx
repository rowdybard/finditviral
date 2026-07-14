import './mascotAnimations.css'

export type MascotMood = 'idle' | 'excited' | 'alert' | 'sleeping' | 'walking'

export default function MascotSprite({ mood = 'idle' }: { mood?: MascotMood }) {
  const bodyClass =
    mood === 'excited'
      ? 'mascot-excited'
      : mood === 'alert'
        ? 'mascot-alert'
        : mood === 'walking'
          ? 'mascot-trot'
          : mood === 'sleeping'
            ? ''
            : 'mascot-idle'
  const wideEyes = mood === 'excited' || mood === 'alert'

  return (
    <svg
      viewBox="0 0 80 80"
      className={`h-16 w-16 select-none ${bodyClass}`}
      aria-hidden="true"
    >
      {/* Tail */}
      <g className="mascot-tail-wag" style={{ transformOrigin: '18px 52px' }}>
        <path d="M18 52 Q8 48 6 38" stroke="#c2410c" strokeWidth="5" strokeLinecap="round" fill="none" />
      </g>

      {/* Body */}
      {mood === 'walking' ? (
        <>
          {/* Legs */}
          <g stroke="#1c1917" strokeWidth="1.5" fill="#f97316">
            <rect className="mascot-leg-a" x="27" y="62" width="5.5" height="12" rx="2.75" style={{ transformOrigin: '30px 62px' }} />
            <rect className="mascot-leg-b" x="36" y="63" width="5.5" height="12" rx="2.75" style={{ transformOrigin: '39px 63px' }} />
            <rect className="mascot-leg-a" x="44" y="63" width="5.5" height="12" rx="2.75" style={{ transformOrigin: '47px 63px', animationDelay: '0.1s' }} />
            <rect className="mascot-leg-b" x="52" y="62" width="5.5" height="12" rx="2.75" style={{ transformOrigin: '55px 62px', animationDelay: '0.1s' }} />
          </g>
          <ellipse cx="40" cy="56" rx="21" ry="13" fill="#f97316" stroke="#1c1917" strokeWidth="2.5" />
          <ellipse cx="40" cy="59" rx="13" ry="7" fill="#fffdf7" />
        </>
      ) : (
        <>
          <ellipse cx="40" cy="58" rx="22" ry="16" fill="#f97316" stroke="#1c1917" strokeWidth="2.5" />
          <ellipse cx="40" cy="62" rx="14" ry="9" fill="#fffdf7" />
          {/* Front paws (sitting) */}
          <ellipse cx="33" cy="72" rx="5" ry="2.8" fill="#fb923c" stroke="#1c1917" strokeWidth="1.5" />
          <ellipse cx="47" cy="72" rx="5" ry="2.8" fill="#fb923c" stroke="#1c1917" strokeWidth="1.5" />
        </>
      )}

      {/* Head */}
      <circle cx="40" cy="34" r="20" fill="#f97316" stroke="#1c1917" strokeWidth="2.5" />

      {/* Ears */}
      <g className="mascot-ear-twitch" style={{ transformOrigin: '24px 20px' }}>
        <ellipse cx="24" cy="20" rx="7" ry="11" fill="#c2410c" stroke="#1c1917" strokeWidth="2" transform="rotate(-15 24 20)" />
        <ellipse cx="24" cy="21" rx="3.5" ry="6" fill="#fb923c" transform="rotate(-15 24 21)" />
      </g>
      <g className="mascot-ear-twitch" style={{ transformOrigin: '56px 20px', animationDelay: '0.3s' }}>
        <ellipse cx="56" cy="20" rx="7" ry="11" fill="#c2410c" stroke="#1c1917" strokeWidth="2" transform="rotate(15 56 20)" />
        <ellipse cx="56" cy="21" rx="3.5" ry="6" fill="#fb923c" transform="rotate(15 56 21)" />
      </g>

      {/* Detective hat */}
      <path d="M28 23 Q28 10 40 9 Q52 10 52 23 Z" fill="#1c1917" />
      <rect x="28" y="18.5" width="24" height="3.5" rx="1.5" fill="#57534e" />
      <ellipse cx="40" cy="23.5" rx="18" ry="3.5" fill="#1c1917" />

      {/* Snout */}
      <ellipse cx="40" cy="40" rx="10" ry="7" fill="#fffdf7" stroke="#1c1917" strokeWidth="1.5" />

      {/* Nose */}
      <ellipse cx="40" cy="37" rx="3.5" ry="2.5" fill="#1c1917" />

      {/* Eyes */}
      {mood === 'sleeping' ? (
        <>
          <path d="M31 31 Q33 33 35 31" stroke="#1c1917" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M45 31 Q47 33 49 31" stroke="#1c1917" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <g className="mascot-blink" style={{ transformOrigin: '33px 32px' }}>
            <circle cx="33" cy="32" r={wideEyes ? 4.5 : 3.5} fill="#1c1917" />
            <circle cx="34" cy="31" r={wideEyes ? 1.5 : 1} fill="#fff" />
          </g>
          <g className="mascot-blink" style={{ transformOrigin: '47px 32px' }}>
            <circle cx="47" cy="32" r={wideEyes ? 4.5 : 3.5} fill="#1c1917" />
            <circle cx="48" cy="31" r={wideEyes ? 1.5 : 1} fill="#fff" />
          </g>
        </>
      )}

      {/* Monocle */}
      <circle cx="47" cy="32" r="6" fill="rgba(255,253,247,0.3)" stroke="#1c1917" strokeWidth="2" />
      <path d="M43.5 29.5 Q45 27.8 46.8 27.5" stroke="#fff" strokeWidth="1" opacity="0.7" fill="none" strokeLinecap="round" />
      <path d="M51.5 36.5 Q56 44 54 52" stroke="#1c1917" strokeWidth="1.2" fill="none" />

      {/* Sleep zzz */}
      {mood === 'sleeping' && (
        <g fill="#1c1917" fontWeight="bold">
          <text x="58" y="18" fontSize="9" className="mascot-zzz">z</text>
          <text x="64" y="11" fontSize="7" className="mascot-zzz" style={{ animationDelay: '1.2s' }}>z</text>
        </g>
      )}

      {/* Mouth */}
      {mood === 'excited' ? (
        <path d="M36 43 Q40 47 44 43" stroke="#1c1917" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      ) : mood === 'alert' ? (
        <circle cx="40" cy="43" r="2" fill="none" stroke="#1c1917" strokeWidth="1.5" />
      ) : mood === 'sleeping' ? (
        <line x1="37" y1="43" x2="43" y2="43" stroke="#1c1917" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <path d="M37 42 Q40 44 43 42" stroke="#1c1917" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      )}
    </svg>
  )
}
