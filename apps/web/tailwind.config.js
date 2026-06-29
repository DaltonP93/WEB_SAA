/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "rgb(var(--c-primary) / <alpha-value>)",
        secondary: "rgb(var(--c-secondary) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        ink: "rgb(var(--c-text) / <alpha-value>)",
      },
      fontFamily: {
        heading: ["var(--f-heading)", "system-ui", "sans-serif"],
        body: ["var(--f-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
      },
    },
  },
  plugins: [],
};
