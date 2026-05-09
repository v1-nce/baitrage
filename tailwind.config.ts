import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        calm: {
          ink: "#11201d",
          mist: "#eef8f5",
          surface: "rgba(246, 252, 250, 0.78)",
          line: "rgba(47, 87, 80, 0.16)",
          green: "#4f9f85",
          blue: "#5c8ea8",
          amber: "#b7853e",
          red: "#b84c4c"
        }
      },
      boxShadow: {
        mirror: "0 18px 60px rgba(25, 54, 49, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
