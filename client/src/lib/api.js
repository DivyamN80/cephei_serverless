import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

// In-memory access token store. Never persisted to localStorage since the
// token is short-lived and refreshed via the httpOnly refresh cookie.
let accessToken = null

export function setAccessToken(token) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // send the httpOnly refresh cookie
})

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

let refreshPromise = null

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const status = error.response?.status
    const isAuthRoute =
      originalRequest?.url?.includes('/api/auth/login') ||
      originalRequest?.url?.includes('/api/auth/register') ||
      originalRequest?.url?.includes('/api/auth/refresh')

    if (status === 401 && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true
      try {
        if (!refreshPromise) {
          refreshPromise = api
            .post('/api/auth/refresh')
            .then((res) => {
              setAccessToken(res.data.accessToken)
              return res.data.accessToken
            })
            .finally(() => {
              refreshPromise = null
            })
        }
        const newToken = await refreshPromise
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch (refreshError) {
        setAccessToken(null)
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return error?.response?.data?.error || error?.response?.data?.message || error?.message || fallback
}

export default api
