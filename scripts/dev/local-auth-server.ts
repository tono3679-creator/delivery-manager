/**
 * ローカル開発用の簡易認証サーバー（Supabase Auth の一部 API を再現）。
 * Docker や Supabase CLI が使えない環境で、ログイン・匿名ログインの動作確認とテストに使う。
 * 本番では使わない（本番は Supabase Auth）。
 *
 *   npm run dev:auth      … http://localhost:54321/auth/v1 で待ち受け
 *
 * 必要な環境変数：DATABASE_URL（ローカル DB）、LOCAL_JWT_SECRET（任意）
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import postgres from "postgres";

const PORT = Number(process.env.LOCAL_AUTH_PORT ?? 54321);
const SECRET = process.env.LOCAL_JWT_SECRET ?? "local-dev-secret-do-not-use-in-production";
const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dm", {
  max: 2,
  onnotice: () => {},
});

type UserRow = { id: string; email: string | null; is_anonymous: boolean; created_at: Date };
const refreshTokens = new Map<string, string>();

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verify(token: string): Record<string, unknown> | null {
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  if (expected !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function userJson(u: UserRow) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email ?? "",
    is_anonymous: u.is_anonymous,
    app_metadata: { provider: u.is_anonymous ? "anonymous" : "email", providers: [] },
    user_metadata: {},
    identities: [],
    created_at: u.created_at.toISOString(),
    updated_at: u.created_at.toISOString(),
  };
}

function session(u: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const accessToken = sign({
    sub: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email ?? "",
    is_anonymous: u.is_anonymous,
    iat: now,
    exp: now + expiresIn,
    session_id: randomUUID(),
  });
  const refreshToken = randomBytes(24).toString("hex");
  refreshTokens.set(refreshToken, u.id);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: refreshToken,
    user: userJson(u),
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function error(res: ServerResponse, status: number, code: string, message: string) {
  send(res, status, { code: status, error_code: code, msg: message });
}

async function findUser(id: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`select id, email, is_anonymous, created_at from auth.users where id = ${id}`;
  return rows[0] ?? null;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const path = url.pathname.replace(/^\/auth\/v1/, "");

    if (path === "/.well-known/jwks.json") return send(res, 200, { keys: [] });
    if (path === "/health") return send(res, 200, { ok: true });

    if (path === "/signup" && req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.email === "string") {
        const rows = await sql<UserRow[]>`
          insert into auth.users (email, encrypted_password)
          values (${body.email}, extensions.crypt(${String(body.password ?? "")}, extensions.gen_salt('bf')))
          returning id, email, is_anonymous, created_at`;
        return send(res, 200, session(rows[0]));
      }
      const rows = await sql<UserRow[]>`
        insert into auth.users (is_anonymous) values (true) returning id, email, is_anonymous, created_at`;
      return send(res, 200, session(rows[0]));
    }

    if (path === "/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      const body = await readBody(req);
      if (grant === "password") {
        const rows = await sql<UserRow[]>`
          select id, email, is_anonymous, created_at from auth.users
           where email = ${String(body.email ?? "")}
             and encrypted_password = extensions.crypt(${String(body.password ?? "")}, encrypted_password)`;
        if (!rows[0]) return error(res, 400, "invalid_credentials", "Invalid login credentials");
        return send(res, 200, session(rows[0]));
      }
      if (grant === "refresh_token") {
        const token = String(body.refresh_token ?? "");
        const userId = refreshTokens.get(token);
        const user = userId ? await findUser(userId) : null;
        if (!user) return error(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
        refreshTokens.delete(token);
        return send(res, 200, session(user));
      }
      return error(res, 400, "unsupported_grant_type", "unsupported grant type");
    }

    if (path === "/user" && req.method === "GET") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const claims = verify(token);
      const user = claims?.sub ? await findUser(String(claims.sub)) : null;
      if (!user) return error(res, 403, "bad_jwt", "invalid JWT");
      return send(res, 200, userJson(user));
    }

    if (path === "/logout" && req.method === "POST") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      return res.end();
    }

    return error(res, 404, "not_found", `not implemented: ${req.method} ${path}`);
  } catch (e) {
    console.error(e);
    return error(res, 500, "unexpected_failure", e instanceof Error ? e.message : "error");
  }
});

server.listen(PORT, () => {
  console.log(`local auth server: http://localhost:${PORT}/auth/v1`);
});
