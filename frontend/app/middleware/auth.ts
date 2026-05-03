export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, fetch } = useUserSession()

  // fetch() is only needed client-side; server-side session is populated automatically
  if (import.meta.client) {
    await fetch()
  }

  if (!loggedIn.value) {
    return navigateTo("/login")
  }
})
