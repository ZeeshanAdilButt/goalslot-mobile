// Extracts a user-facing message from an API error.
//
// The API layer (packages/shared/src/api/client.ts) throws raw axios
// errors. For a rejected request axios attaches the parsed response body at
// `err.response.data`, and this API's error responses always shape that as
// `{ message: string }` (e.g. login's "Invalid credentials"). Falling back
// to `err.message` instead — as `err instanceof Error ? err.message : ...`
// does — surfaces axios's generic "Request failed with status code 401"
// rather than the real reason, which is not actionable for the user.
//
// Duck-typed rather than importing `axios` directly: axios is a dependency
// of @goalslot/shared, not of this app, so `isAxiosError` isn't reliably
// resolvable here without adding a dependency.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) {
      return response.data.message;
    }
  }
  return err instanceof Error ? err.message : fallback;
}
