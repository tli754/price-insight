const gatewayUrl = process.env.NUXT_GATEWAY_URL ?? "http://localhost:4001"

export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  routeRules: {
    "/": { redirect: "/products" },
    "/api/health": {},
    "/api/_nuxt_icon/**": {},
    "/api/_nuxt/**": {},
    "/api/**": { proxy: `${gatewayUrl}/api/**` },
    "/auth/**": { proxy: `${gatewayUrl}/auth/**` },
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
