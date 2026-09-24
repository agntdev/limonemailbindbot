# Email Bind Bot — Bot specification

**Archetype:** crm

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A compact Telegram bot that lets users bind and verify an email address to their Telegram account for account recovery and notifications; admins receive bind/unbind alerts and can list or remove bindings. Verification uses short codes emailed to the user and bindings are stored persistently with an audit log.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- community owners (SMB, groups)
- product owners who need email recovery/notification capture
- admins who need a simple inbox of binds/unbinds

## Success criteria

- Users can submit an email, receive a verification code by email, enter the code, and see their binding marked verified.
- Admin (ADMIN_CHAT_ID) receives a notification message for every successful bind and unbind.
- Bindings and verification state persist across restarts and can be listed/unbound by the admin.
- Verification codes expire after the configured TTL and cannot be reused.

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **Bind email** (button, actor: user, callback: bind:start) — Begin binding flow (prompts for email or suggests /bind)
  - outputs: Prompt: 'Please enter your email or use /bind <email>' (ForceReply or hint), If user types email: validate and send verification code
- **/bind** (command, actor: user, command: /bind <email>) — User submits email address to bind (free-form typed input required)
  - inputs: email
  - outputs: Store pending binding, send verification code to email, prompt for code entry
- **/verify** (command, actor: user, command: /verify <code>) — Enter verification code to complete binding
  - inputs: 6-digit code
  - outputs: Mark email verified, notify admin, confirm to user
- **Enter code** (button, actor: user, callback: verify:start) — Prompt to enter the verification code (ForceReply)
  - outputs: Accept code via message or /verify, confirm success/failure
- **/status** (command, actor: user, command: /status) — Show current bound email and verification state
  - outputs: Display telegram_id, email (masked), verified boolean, verified_at if present
- **Unbind** (button, actor: user, callback: unbind:confirm) — Start unbind flow (asks confirmation via buttons)
  - outputs: Yes/No confirmation buttons, on Yes remove binding and notify admin
- **/list_bindings** (command, actor: admin, command: /list_bindings) — Admin-only: list current bindings (works only in ADMIN_CHAT_ID)
  - outputs: Paginated list of bindings (telegram_id, display_name, masked email, verified, verified_at)
- **/unbind** (command, actor: admin, command: /unbind <telegram_id>) — Admin-only: unbind a user by telegram_id (works only in ADMIN_CHAT_ID)
  - inputs: telegram_id
  - outputs: Remove binding, record audit entry, notify the targeted user and admin chat

## Flows

### Bind email (happy path)
_Trigger:_ /bind <email> or Bind email button

1. Validate email format, reject obvious invalid input
2. Store pending binding (verified=false) and create single-use 6-digit verification token with expiry (15 minutes)
3. Send code to provided email via built-in SMTP relay (or owner-provided SMTP if configured)
4. Prompt user to enter code (button or /verify)
5. On correct code: mark verified=true, set verified_at, notify admin (ADMIN_CHAT_ID), send confirmation to user, log audit

_Data touched:_ User, Verification token, Audit log

### Verify code (user enters code)
_Trigger:_ User message containing numeric code or /verify <code>

1. Match code to pending token for this telegram_id, check expiry and single-use
2. On success: mark token used, set user's verified=true and verified_at, delete/expire token, send confirmation to user, send admin notification, append audit
3. On failure: return clear error (invalid or expired), offer Resend and Retry options

_Data touched:_ Verification token, User, Audit log

### Resend code
_Trigger:_ User requests resend (button or command) or previous code expired

1. Invalidate previous token(s) for that pending binding, create new token with fresh expiry, email new code, notify user
2. Rate-limit resends (e.g., 3 times in TTL window) and surface helpful error if rate limit reached

_Data touched:_ Verification token, Audit log

### Status
_Trigger:_ /status

1. Fetch user record by telegram_id and present masked email, verified boolean, verified_at, created_at, last_updated
2. If no binding present, show friendly empty state and button to Bind email

_Data touched:_ User

### User unbind
_Trigger:_ Unbind button or /unbind by user

1. Show Yes/No confirmation inline buttons
2. On confirm: delete binding (or mark deleted), add audit entry, notify admin, confirm to user
3. On cancel: return to menu

_Data touched:_ User, Audit log

### Admin list and remote unbind
_Trigger:_ /list_bindings or /unbind <telegram_id> in ADMIN_CHAT_ID

1. Verify request comes from configured ADMIN_CHAT_ID
2. For /list_bindings: return a paginated list of current bindings (mask emails), include quick unbind buttons per entry
3. For /unbind: remove binding, add audit entry, notify the user about forced unbind, confirm action to admin

_Data touched:_ User, Audit log

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Telegram chat ID where bind/unbind notifications are sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **User** _(retention: persistent)_ — Represents a Telegram user and their bound email
  - fields: telegram_id (integer), display_name (string), email (string, stored as provided), verified (boolean), verified_at (datetime|null), created_at (datetime), last_updated (datetime), deleted_at (datetime|null)
- **Verification token** _(retention: persistent)_ — Single-use 6-digit numeric code tied to a user and expiry
  - fields: token (string, 6-digit), telegram_id (integer), created_at (datetime), expires_at (datetime), used (boolean)
- **Audit log** _(retention: persistent)_ — Immutable log of bind/unbind events for 90 days
  - fields: event_type (bind|verify|unbind|resend), telegram_id, email_snapshot, actor (user|admin|system), timestamp, notes
- **Admin config** _(retention: persistent)_ — Owner-supplied configuration such as admin chat and optional SMTP credentials (separate store with restricted access)
  - fields: admin_chat_id, smtp_config_present (boolean), verification_ttl_minutes, resend_rate_limit

## Integrations

- **Telegram** (required) — Bot API messaging and callbacks
- **SMTP (built-in relay; owner can supply credentials)** (optional) — Deliver verification codes to user emails
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set or update ADMIN_CHAT_ID (where bind/unbind notifications go)
- Configure optional SMTP credentials (host, port, username, password) for outgoing verification emails
- Adjust verification code TTL and resend rate limits
- Export current bindings (CSV) and purge audit logs older than retention period
- Enable/disable accepting duplicate emails across users

## Notifications

- Admin notification when user completes verification: includes telegram_id, display_name, masked email, verification timestamp
- Admin notification when a binding is removed (user-initiated or admin-initiated)
- User notifications: verification code sent, verification success, unbind confirmation, error/delivery failure with instructions

## Permissions & privacy

- Email addresses are stored for recovery/notification only and visible to the configured admin chat.
- Audit log retained for 90 days, bindings retained until user unbinds or admin removes them.
- Access to stored SMTP credentials is restricted and not required to operate (built-in relay used by default).
- Do not send email contents to admin; admin receives only event notifications and masked email in lists.

## Edge cases

- User submits an email already bound to another telegram_id: surface clear message and either reject or allow depending on owner setting (see missing_fields)
- Verification code delivery fails (SMTP down or bounce): notify user and admin; allow retry after short delay
- User loses the code or it expires: allow 'Resend' with rate limits and audit entry
- Multiple pending tokens: only the most recent token is valid; earlier tokens must be invalidated
- Admin commands sent from a non-admin chat: reject and log attempt
- User blocks the bot or deletes chat: admin still gets audit notifications but user cannot be reached for confirmations
- Race conditions: two simultaneous bind attempts from same user—ensure tokens and final state remain consistent
- Bot restarted mid-flow: pending tokens and user state persist so flow can be resumed

## Required tests

- Dialog-level: full bind flow (send /bind, receive code, verify using /verify and via typing code) results in verified state and admin notification
- Dialog-level: expired code is rejected and Resend produces a new valid code
- Dialog-level: unbind flow with user confirmation removes binding and notifies admin
- Admin: /list_bindings returns paginated masked emails and /unbind <telegram_id> removes binding and notifies user
- Persistence: data persists across simulated restarts (user record, tokens, audit log)
- Edge-case: rate-limit resends and block repeated resend attempts
- Security: verification token is single-use and cannot be replayed
- Negative test: commands executed from non-ADMIN_CHAT_ID that require admin are rejected

## Assumptions

- Single ADMIN_CHAT_ID is sufficient for owner notification (multi-admin support is optional and not required initially)
- Built-in SMTP relay is available for outgoing emails; owner may add SMTP credentials later but not required for initial deploy
- Default verification method is a 6-digit numeric code with 15-minute expiry
- Bindings are unique per telegram_id; uniqueness per email across users is configurable (default: allow duplicates)
- Audit log retention default is 90 days
