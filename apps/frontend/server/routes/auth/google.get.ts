export default defineOAuthGoogleEventHandler({
  config: {
    accessType: "offline",
    prompt: "select_account"
  },
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        id: user.sub,
        email: user.email,
        name: user.name,
        avatar: user.picture
      },
      loggedInAt: new Date().toISOString()
    })

    return sendRedirect(event, "/products")
  },
  onError(event, error) {
    console.error("Google OAuth error:", error)
    return sendRedirect(event, "/login?error=google_oauth_failed")
  }
})
