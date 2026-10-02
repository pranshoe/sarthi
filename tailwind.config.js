export default {
  content: ["./src/**/*.{ts,tsx,html}", "./mock-scores/**/*.html"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#1a56db",
          600: "#1a56db",
          700: "#1648b5",
        },
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans", "system-ui", "sans-serif"],
        indic: ["Noto Sans Devanagari", "Noto Sans Tamil", "Noto Sans Kannada", "sans-serif"],
      },
    },
  },
  plugins: [],
};