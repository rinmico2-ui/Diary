/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm neutrals — the paper this app is printed on.
        canvas: '#faf6f2',
        surface: '#ffffff',
        'surface-sunk': '#f4ece6',
        line: '#eadfd6',
        ink: {
          DEFAULT: '#2f2723',
          soft: '#6b5d54',
          faint: '#9c8d83',
        },
        // One restrained accent: a soft, mature rose.
        rose: {
          50: '#fdf5f3',
          100: '#fae8e4',
          200: '#f3d0c8',
          300: '#e8ada0',
          400: '#d98a7a',
          500: '#c86e5d',
          600: '#b15544',
          700: '#8f4235',
        },
        sage: {
          100: '#e7efe9',
          400: '#8fae9a',
          600: '#5d7f68',
        },
        sand: {
          100: '#f7efe4',
          300: '#e8d5bd',
          500: '#c9a97f',
        },
      },
      fontFamily: {
        sans: ['"Fraunces"', 'Georgia', '"Times New Roman"', 'serif'],
        body: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '1.25rem',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(47, 39, 35, 0.04), 0 8px 24px -12px rgba(47, 39, 35, 0.14)',
        lift: '0 2px 4px rgba(47, 39, 35, 0.05), 0 18px 40px -18px rgba(47, 39, 35, 0.24)',
        float: '0 10px 40px -12px rgba(47, 39, 35, 0.28)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '60%': { transform: 'scale(1.01)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'heart-burst': {
          '0%': { opacity: '0', transform: 'scale(0.4)' },
          '45%': { opacity: '1', transform: 'scale(1.25)' },
          '100%': { opacity: '0', transform: 'scale(1.5)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(0, -18px, 0) scale(1.04)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-in': 'pop-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'heart-burst': 'heart-burst 0.7s ease-out forwards',
        shimmer: 'shimmer 1.6s infinite',
        drift: 'drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
