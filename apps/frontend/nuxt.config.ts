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
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET || ""
      }
    },
    public: {
      // devAuthBypass: !!process.env.NUXT_DEV_AUTH_BYPASS,
      devAuthBypass: true,
    }
  }
})
