/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        xdm: {
          bg: "#0b0f17",
          panel: "#111827",
          card: "#1e293b",
          border: "#334155",
          accent: "#3b82f6",
          emerald: "#10b981",
          amber: "#f59e0b",
          rose: "#f43f5e"
        }
      }
    },
  },
  plugins: [],
};
