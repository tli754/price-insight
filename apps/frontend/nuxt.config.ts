export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  routeRules: {
    "/": { redirect: "/products" },
    "/api/**": { proxy: "http://localhost:4001/api/**" },
    "/auth/**": { proxy: "http://localhost:4001/auth/**" },
  },
  modules: ["@nuxt/ui", "@nuxt/eslint"],
  eslint: {
    config: {
      typescript: true,
    },
  },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {}
})
