// Ported from dw-time-web/src/lib/api.ts (authApi). Needed now for phase 3.3
// (mobile auth) even though this package doesn't implement a UI for it.

import type { AxiosInstance } from 'axios'

import type { User } from '../types/user'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface LoginResponse extends AuthTokens {
  user: User
}

export function createAuthApi(api: AxiosInstance) {
  return {
    checkEmailExists: (email: string) => api.get('/auth/check-email', { params: { email } }),
    sendOTP: (data: { email: string; purpose: 'SIGNUP' | 'FORGOT_PASSWORD' }) => api.post('/auth/send-otp', data),
    verifyOTP: (data: { email: string; otp: string; purpose: 'SIGNUP' | 'FORGOT_PASSWORD' }) =>
      api.post('/auth/verify-otp', data),
    forgotPassword: (data: { email: string }) => api.post('/auth/forgot-password', data),
    resetPassword: (data: { email: string; otp: string; newPassword: string }) =>
      api.post('/auth/reset-password', data),
    register: (data: { email: string; password: string; name: string; otp: string }) =>
      api.post<LoginResponse>('/auth/register', data),
    login: (data: { email: string; password: string }) => api.post<LoginResponse>('/auth/login', data),
    ssoLogin: (data: { token: string; email: string; name?: string }) =>
      api.post<LoginResponse>('/auth/sso', data),
    getProfile: () => api.get<User>('/auth/me'),
    refresh: (data: { refreshToken: string }) => api.post<AuthTokens>('/auth/refresh', data),
    sendChangePasswordOTP: (data: { currentPassword: string }) =>
      api.post('/auth/send-change-password-otp', data),
    changePassword: (data: { currentPassword: string; otp: string; newPassword: string }) =>
      api.post('/auth/change-password', data),
  }
}
