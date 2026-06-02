import { proxyRequest } from 'h3'

export default defineEventHandler(async (event) => {
  const { apiUrl } = useRuntimeConfig()
  return proxyRequest(event, `${apiUrl}/api/competitors`)
})
