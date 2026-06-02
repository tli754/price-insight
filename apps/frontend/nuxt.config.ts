export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  routeRules: {
    "/": { redirect: "/products" }
  },
  modules: ["@nuxt/ui", "nuxt-auth-utils", "@nuxt/eslint"],
  eslint: {
    config: {
      typescript: true,
    },
  },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    devAuthPassword: process.env.NUXT_DEV_AUTH_PASSWORD || "",
    apiUrl: process.env.NUXT_API_URL || "http://localhost:4000",
    public: {
      // devAuthBypass: !!process.env.NUXT_DEV_AUTH_BYPASS,
      devAuthBypass: true,
    }
  }
})
