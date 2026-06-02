import { proxyRequest, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  await requireUserSession(event)
  const { apiUrl } = useRuntimeConfig()
  const { id } = getRouterParams(event)
  return proxyRequest(event, `${apiUrl}/api/competitors/${id}/products`)
})
