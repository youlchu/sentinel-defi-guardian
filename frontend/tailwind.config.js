/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sentinel: {
          primary: '#6366f1',
          secondary: '#8b5cf6',
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          dark: '#0f172a',
        }
      }
    },
  },
  plugins: [],
}