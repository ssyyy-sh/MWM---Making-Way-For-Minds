import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// This repo is a GitHub Pages *project* site, served from a subpath:
// https://ssyyy-sh.github.io/MWM---Making-Way-For-Minds/
// Vite needs to know that subpath so every asset URL it generates is correct.
const BASE_PATH = "/MWM---Making-Way-For-Minds/";

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: {
        name: "MWM — Making Way for Minds",
        short_name: "MWM",
        description: "Researching educational accessibility through stories, interviews, and data.",
        theme_color: "#16243F",
        background_color: "#F7F4EA",
        display: "standalone",
        start_url: BASE_PATH,
        scope: BASE_PATH,
        icons: []
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ]
});