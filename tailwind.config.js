/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // TensionLines brand colors
        cream: '#FDFCFA',
        gold: '#D4A574',
        black: '#1A1613',
        accent: {
          primary: '#D4A574',
          secondary: '#E5C9A7',
          tertiary: '#F5E6D3'
        },
        neutral: {
          50: '#FDFCFA',
          100: '#F8F6F4',
          200: '#F0EDE8',
          300: '#E8E3DC',
          400: '#D0C8BD',
          500: '#B8AC9E',
          600: '#9A8B7A',
          700: '#7C6C5B',
          800: '#5E4E3C',
          900: '#1A1613'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Libre Baskerville', 'Georgia', 'serif']
      }
    },
  },
  plugins: [],
}
