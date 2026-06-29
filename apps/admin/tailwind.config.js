/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "#004884",
        brand2: "#00bcd1",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "4px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
    },
  },
  plugins: [],
};
