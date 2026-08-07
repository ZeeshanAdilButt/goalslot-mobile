// Ported from dw-time-web/src/lib/store.ts (type only — the zustand store
// itself is web-app state management and does not belong in a shared package;
// mobile and web each own their own auth store built on top of this type and
// on the api client / TokenStorage seam in ../api).

export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER'
  userType: 'INTERNAL' | 'EXTERNAL' | 'SSO'
  plan: 'FREE' | 'BASIC' | 'PRO'
  unlimitedAccess: boolean
  subscriptionStatus?: string
  subscriptionEndDate?: string | null
  preferences?: {
    timezone?: string
    [key: string]: unknown
  }
  limits: {
    maxGoals: number
    maxSchedules: number
    maxTasksPerDay: number
  }
}
