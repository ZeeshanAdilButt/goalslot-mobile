// Ported from dw-time-web/src/lib/api.ts (usersApi) — the account-level
// routes, as opposed to ./auth.ts's session-level ones. Added for the mobile
// Settings screen, which is the first mobile surface that edits the account
// rather than just reading it back off `/auth/me`.
//
// Only three of web's usersApi routes are here, deliberately:
//
//   - The admin block (`/users/admin/*` — list users, grant/revoke free Pro,
//     disable an account) has no mobile UI and shouldn't grow one by
//     accident just because the method exists on the client.
//   - `PUT /users/password` is NOT ported. It exists on web's client and on
//     the API, but it has zero call sites in dw-time-web/src — the Security
//     tab uses the OTP flow in ./auth.ts (`sendChangePasswordOTP` then
//     `changePassword`) instead, and so does mobile. Porting the unused
//     single-shot variant would offer a second, weaker path to the same
//     change.
//
// `updateProfile` accepts exactly what the API's UpdateUserDto accepts
// (dw-time-api/src/modules/users/dto/users.dto.ts) — `name` and `avatar`,
// nothing else. The API runs a global ValidationPipe with `whitelist: true`,
// so any other field is silently dropped rather than rejected: an `email` or
// `timezone` sent from here would appear to succeed and change nothing.

import type { AxiosInstance } from 'axios'

import type { User } from '../types/user'

export interface UpdateProfileForm {
  name?: string
  /** URL of an already-hosted image. There is no upload endpoint on the API. */
  avatar?: string
}

export function createUsersApi(api: AxiosInstance) {
  return {
    /** Same payload as `authApi.getProfile()` (`GET /auth/me`); both return `sanitizeUser(user)`. */
    getProfile: () => api.get<User>('/users/profile'),
    updateProfile: (data: UpdateProfileForm) => api.put<User>('/users/profile', data),
    /**
     * Permanent and immediate — the API runs `prisma.user.delete()`, which
     * cascades to goals, tasks, time entries, journal, notes and the stored
     * BYOK key. There is no soft-delete, no grace period, and the route
     * itself asks for no re-authentication, so every bit of the confirmation
     * friction has to live in the client.
     */
    deleteAccount: () => api.delete<{ success: boolean }>('/users/account'),
  }
}
