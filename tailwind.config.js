/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        vibrate: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-2px)' },
          '75%': { transform: 'translateX(2px)' },
        },
        pulse: {
          '0%, 100%': { transform: 'scale(1)', borderColor: 'rgb(147 51 234)' },
          '50%': { transform: 'scale(1.02)', borderColor: 'rgb(192 132 252)' },
        }
      },
      animation: {
        vibrate: 'vibrate 0.2s ease-in-out',
        pulse: 'pulse 1s ease-in-out',
      }
    },
  },
  plugins: [],
}

