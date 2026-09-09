/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // The self-hosted variable faces register as '<Family> Variable', so
      // each stack leads with that and falls back to the static family name.
      fontFamily: {
        display: ['"Outfit Variable"', 'Outfit', 'system-ui', 'sans-serif'],
        sans: ['"Nunito Variable"', 'Nunito', 'system-ui', 'sans-serif'],
        mono: ['"Space Grotesk Variable"', '"Space Grotesk"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Surfaces
        paper: '#FAF6EF', // app background
        chalk: '#FFF7ED', // warm white
        wash: '#F2ECE1', // section header
        tray: '#F1EADC', // segmented control / inert track
        quiet: '#F6F1E7', // explanatory cards
        hair: '#EDE5D7', // 1px card border
        edge: '#DCD3C2', // 2px ghost-button border

        // Ink
        ink: '#1C1A16',
        ink2: '#2A2621', // rows inside an ink card
        body: '#57524A',
        muted: '#6B6558',
        stone: '#8A8375',
        faint: '#A29A8A',
        onink: '#C9C2B4',

        // Brand
        spark: '#FF6A2B',
        sparkD: '#E14E12', // pressed + solid bottom shadow

        // Data — never themed. A progress bar means the same thing in every
        // theme, so nothing here is allowed to follow the accent.
        pine: '#1F7A6B',
        pineSoft: '#8FC9BE',
        sun: '#FFC542',

        // Theme-driven, written by the theme provider. These four are the
        // whole of "the paint" — a play surface should never need more.
        //
        // No var() fallback on purpose: a comma inside one stops Tailwind's
        // color parser dead and the utility is silently never generated. The
        // Cats defaults live in index.css `:root` instead, which covers the
        // moment before the provider mounts just as well.
        accent: 'rgb(var(--wz-accent) / <alpha-value>)',
        accentDeep: 'rgb(var(--wz-accent-deep) / <alpha-value>)',
        tintA: 'rgb(var(--wz-tint-a) / <alpha-value>)',
        tintB: 'rgb(var(--wz-tint-b) / <alpha-value>)',
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.25)' },
          '100%': { transform: 'scale(1)' },
        },
        wiggle: {
          '0%,100%': { transform: 'rotate(-4deg)' },
          '50%': { transform: 'rotate(4deg)' },
        },
        floaty: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pounce: {
          '0%': { transform: 'translateY(0) scale(1)' },
          '30%': { transform: 'translateY(-24px) scale(1.1)' },
          '100%': { transform: 'translateY(0) scale(1)' },
        },
        confettiFall: {
          '0%': { transform: 'translateY(-20px) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(120px) rotate(360deg)', opacity: '0' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-6px)' },
          '75%': { transform: 'translateX(6px)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        pop: 'pop 0.25s ease-in-out',
        wiggle: 'wiggle 0.4s ease-in-out',
        floaty: 'floaty 3s ease-in-out infinite',
        pounce: 'pounce 0.5s ease-in-out',
        'confetti-fall': 'confettiFall 1.2s ease-in forwards',
        shake: 'shake 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
    },
  },
  plugins: [],
}
