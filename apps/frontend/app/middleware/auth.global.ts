export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === "/login") return

  const fetcher = import.meta.server ? useRequestFetch() : $fetch

  try {
    const session = await fetcher<{ loggedIn: boolean }>("/auth/session")
    if (!session.loggedIn) {
      return navigateTo("/login")
    }
  } catch {
    return navigateTo("/login")
  }
})
