
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter','system-ui','sans-serif'] },
      colors: { teal: { 500: '#0D9488', 600: '#0F766E', 700: '#115E59' }, ink: '#0F2A33' }
    }
  },
  plugins: [],
}
