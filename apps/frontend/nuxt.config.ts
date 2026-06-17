const backendUrl = process.env.NUXT_BACKEND_URL ?? "http://localhost:4000"

export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  routeRules: {
    "/": { redirect: "/products" },
    "/api/health": {},
    "/api/**": { proxy: `${backendUrl}/api/**` },
    "/auth/**": { proxy: `${backendUrl}/auth/**` },
  },
  icon: {
    localApiEndpoint: "/_nuxt_icon",
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
