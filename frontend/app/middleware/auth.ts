export default defineNuxtRouteMiddleware(async () => {
  const { loggedIn, fetch } = useUserSession()

  await fetch()

  if (!loggedIn.value) {
    return navigateTo("/login")
  }
})
