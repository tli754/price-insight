export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/login") return

  try {
    const session = await $fetch<{ loggedIn: boolean }>("/auth/session")
    if (!session.loggedIn) {
      return navigateTo("/login")
    }
  } catch {
    return navigateTo("/login")
  }
})
