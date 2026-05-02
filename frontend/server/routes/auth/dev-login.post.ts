export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  if (!config.devAuthPassword) {
    throw createError({ statusCode: 404 })
  }

  const { password } = await readBody<{ password: string }>(event)

  if (password !== config.devAuthPassword) {
    throw createError({ statusCode: 401, message: "Invalid password" })
  }

  await setUserSession(event, {
    user: {
      id: "dev",
      email: "dev@local",
      name: "Dev User",
      avatar: ""
    },
    loggedInAt: new Date().toISOString()
  })

  return { ok: true }
})