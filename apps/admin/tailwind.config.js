/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#004884",
        brand2: "#00bcd1",
      },
    },
  },
  plugins: [],
};
