const backendUrl = process.env.NUXT_BACKEND_URL ?? "http://localhost:4000"
const leadsUrl = process.env.NUXT_LEADS_URL ?? "http://localhost:4100"

export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  routeRules: {
    "/": { redirect: "/products" },
    "/api/health": {},
    "/api/**": { proxy: `${backendUrl}/api/**` },
    "/auth/**": { proxy: `${backendUrl}/auth/**` },
    // Leads service proxy: `/leads-api/**` → leads `/api/**`. Forwards the
    // pi-session cookie, which the leads service verifies with the shared secret.
    "/leads-api/**": { proxy: `${leadsUrl}/api/**` },
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
