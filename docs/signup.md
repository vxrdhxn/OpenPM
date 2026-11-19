# Sign-up and email verification

Creating a workspace (`POST /api/auth/register`) works one of two ways, set by `SIGNUP_VERIFICATION`
on the API (Helm: `api.signupVerification`):

| Value | Behavior |
| --- | --- |
| `auto` (default) | Verify by email whenever an email provider is configured (`RESEND_API_KEY`), otherwise sign up at once. A fresh install without email keeps working. |
| `required` | Always verify. Sign-up then needs working email. |
| `off` | Never verify: the workspace and its owner are created at once (201 with a session). |

## Verified sign-up

1. **`POST /api/auth/register`** with the usual form. A taken organization URL is refused at once
   (409). That says nothing about any email address. Otherwise the answer is always
   **202** `{ "verification": "email", "message": "Check your email…" }`, and nothing is created yet.
2. **After replying** (so neither the answer nor its timing depends on the address, as for
   forgot-password), the API looks at the email:
   - **New address:** the sign-up is stored in `signup_requests` (migration 026) with the password
     already hashed and only a hash of a new token, and the worker emails
     `APP_URL/verify-signup?token=…`. Signing up again with the same address replaces the request,
     and the older link stops working.
   - **Address with an account:** nothing is stored. The worker emails that account's owner: someone
     tried to create a workspace with your address, with links to sign in and reset the password. At
     most one such email per account per hour (one job id per hour).
3. **`POST /api/auth/verify-signup`** `{ token }` (sent by the `/verify-signup` page, so link
   scanners that only fetch the URL do not use the link up). It creates the organization and its
   owner from the request, consumes it, signs the owner in (201 with a session) and records
   `auth.registered` with `email_verified: true`. If the URL or the address was taken in the
   meantime, the request is dropped and the answer is 409. Unknown, used or expired links are 400.

Links work once and for 24 hours. Expired requests are deleted whenever a new one is made.

With verification on, the sign-up page no longer tells anyone whether an address has an account.
This closes the last account-enumeration gap (`docs/security-model.md`). Sign-in, forgot-password
and reset already answered the same either way.

Code: `apps/api/src/services/auth.ts` (`checkSignupSlug`, `sendSignupLink`, `completeSignup`),
`apps/worker/src/processors/signupVerification.ts` and `signupExistingAccount.ts`. Tested against
Postgres in `apps/api/src/test/integration/signup.int.test.ts`.
