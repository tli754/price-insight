import { proxyRequest, getRouterParams } from 'h3'

export default defineEventHandler(async (event) => {
  const { apiUrl } = useRuntimeConfig()
  const { id, competitorId } = getRouterParams(event)
  return proxyRequest(event, `${apiUrl}/api/products/${id}/competitors/${competitorId}`)
})
