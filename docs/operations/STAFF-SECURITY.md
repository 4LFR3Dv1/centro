# STAFF-SECURITY — Staff Credential Operations

Status: CANDIDATE

Base: `db7c7b485dda6993b9b78a90b0e4334a025125e0` (`ADMIN-004 — Today`)

## Purpose

Make Staff password ownership explicit after the first bootstrap.

`CENTRO_BOOTSTRAP_ADMIN_PASSWORD` is a bootstrap input only. It is not a continuously reconciled password setting and changing it does not mutate `staff_credentials`.

After this cut there are two distinct credential operations:

1. authenticated self-service password change;
2. explicit operator recovery when authentication is unavailable.

They intentionally have different authority and session semantics.

## Authenticated password change

Surface:

- `/admin/seguranca`
- `GET /api/admin/security`
- `POST /api/admin/security/password`

The authenticated Staff member must provide the current password and a new password with at least 12 characters.

The server:

1. resolves the current Staff session;
2. verifies the current password against the persisted Argon2id hash;
3. rejects reuse of the current password;
4. hashes the new password;
5. increments `staff_credentials.password_version`;
6. clears failed attempts and temporary lock state;
7. revokes every other active Staff session for the same identity;
8. preserves the session that performed the change;
9. emits `STAFF_PASSWORD_CHANGED` with actor type `STAFF`.

Plaintext passwords are never persisted or returned.

## Operator recovery

Command:

```bash
npm run admin:password:recover
```

Inputs, in priority order:

- `CENTRO_ADMIN_RECOVERY_USERNAME`
- `CENTRO_ADMIN_RECOVERY_PASSWORD`

with fallback to:

- `CENTRO_BOOTSTRAP_ADMIN_USERNAME`
- `CENTRO_BOOTSTRAP_ADMIN_PASSWORD`

The fallback exists so an operator can intentionally promote the already-configured Railway value into the durable credential without exposing it in logs or source code.

Recovery:

1. finds the named persisted Staff identity;
2. replaces the durable password hash;
3. increments `password_version`;
4. clears failed attempts and temporary lock state;
5. revokes **all** active Staff sessions;
6. emits `STAFF_CREDENTIAL_RECOVERED` with actor type `SYSTEM`.

Recovery does not silently re-enable a disabled credential.

## Bootstrap remains idempotent

Normal application boot still calls `bootstrapFirstAdmin()`.

If a Staff identity already exists, bootstrap does not overwrite its credential. This is intentional and prevents every deploy or environment-variable edit from becoming an implicit password reset.

Therefore:

```text
bootstrap variable change
!=
authenticated password change
!=
operator recovery
```

## UI projection

`/admin/seguranca` may project only operational credential metadata:

- password version;
- credential update timestamp;
- active session count;
- failed-attempt count;
- temporary lock state;
- disabled state.

It never projects `password_hash`, plaintext credentials, recovery variables or session tokens.

## Witness

`server/http/staff-security-api.test.ts` uses real PostgreSQL + HTTP and proves:

- anonymous security access is rejected;
- POST Origin is enforced;
- incorrect current password is rejected;
- current-password reuse is rejected;
- authenticated change increments version;
- current session survives;
- other sessions are revoked;
- old password stops authenticating;
- new password authenticates;
- operator recovery increments version again;
- recovery revokes all active sessions;
- pre-recovery password stops authenticating;
- recovery password authenticates;
- both operations are audited with distinct actor authority.

All existing ADMIN/STUDENT/SCHEDULE/PROCESS/DOCS witnesses remain mandatory.

## Non-goals

This cut does not add:

- password reset by e-mail or SMS;
- forgot-password public endpoints;
- secret display in the UI;
- automatic rotation on deploy;
- automatic credential reconciliation from Railway variables;
- MFA;
- Staff user management or role CRUD.

Those require separate authority.
