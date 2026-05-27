export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "nuxt-auth-utils"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    devAuthPassword: process.env.NUXT_DEV_AUTH_PASSWORD || "",
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET || ""
      }
    },
    public: {
      devAuthBypass: !!process.env.NUXT_DEV_AUTH_BYPASS,
      apiUrl: process.env.NUXT_PUBLIC_API_URL || "http://localhost:4000"
    }
  }
})
