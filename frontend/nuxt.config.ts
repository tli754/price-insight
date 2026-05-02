export default defineNuxtConfig({
  compatibilityDate: "2026-05-02",
  devtools: { enabled: true },
  modules: ["@nuxt/ui", "nuxt-auth-utils"],
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET || ""
      }
    }
  }
})
