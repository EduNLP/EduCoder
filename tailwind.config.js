/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/context/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
      },
      dropShadow: {
        glow: '0 0 25px rgba(56, 189, 248, 0.45)',
      },
      backgroundImage: {
        'soft-gradient':
          'radial-gradient(circle at 12% 20%, rgba(99,102,241,0.25), transparent 45%), radial-gradient(circle at 85% 15%, rgba(14,165,233,0.2), transparent 40%)',
      },
    },
  },
  plugins: [],
}

