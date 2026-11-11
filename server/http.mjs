import {
  createPublicKey,
  timingSafeEqual,
  verify
} from "node:crypto";
import {
  readFile
} from "node:fs/promises";
import {
  extname,
  resolve,
  sep
} from "node:path";
import {
  directions,
  professions,
  sectors
} from "../web/catalog.js";
import {
  Problem
} from "./store.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf"
};
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
};
const absent = () => new Problem(404, "Запись не найдена.");
const unauthorized = () => new Problem(401, "Для доступа войдите через портал SAQ.");

export function settings(env, directory, pem) {
  if (!env.OGA_ISSUER || !env.OGA_AUDIENCE) throw Error("Set OGA_ISSUER and OGA_AUDIENCE");
  const objects = new Map();
  for (const p of directory.objects || []) {
    if (!/^\d{12}$/.test(p.id) || objects.has(p.id) || !Object.hasOwn(sectors, p.sector) ||
      !p.name || !["bin", "iin"].includes(p.idType) || (p.sector === "private" && !Object.hasOwn(professions,
        p.category))) throw Error("Invalid directory entry");
    objects.set(p.id, p);
  }
  const users = new Map(Object.entries(directory.representatives || {}));
  for (const id of users.values())
    if (!objects.has(id)) throw Error("Unknown represented object");
  const keys = Object.fromEntries(Object.keys(directions).map(key => [key, env["OGA_SOURCE_" + key
    .toUpperCase()]]).filter(([, v]) => v));
  if (Object.values(keys).some(k => k.length < 32) || new Set(Object.values(keys)).size !== Object.keys(keys)
    .length) throw Error("Source keys must be distinct, at least 32 characters");
  const publicKey = createPublicKey(pem);
  if (publicKey.asymmetricKeyType !== "rsa") throw Error("An RSA signing public key is required");
  return {
    issuer: env.OGA_ISSUER,
    audience: env.OGA_AUDIENCE,
    publicKey,
    objects,
    users,
    keys
  };
}

function session(req, config) {
  const cookie = (req.headers.cookie || "").split(/;\s*/).find(k => k.startsWith("saq_access="))?.slice(11);
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] || cookie;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw 0;
    const [header, body, sig] = parts;
    const head = JSON.parse(Buffer.from(header, "base64url"));
    if (head.alg !== "RS256" || !verify("RSA-SHA256", Buffer.from(header + "." + body), config.publicKey,
        Buffer.from(sig, "base64url"))) throw 0;
    const claims = JSON.parse(Buffer.from(body, "base64url"));
    const now = Date.now() / 1000;
    if (claims.iss !== config.issuer || ![claims.aud].flat().includes(config.audience) || !claims.sub || !
      Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf !== undefined && (!Number.isFinite(
        claims.nbf) || claims.nbf > now))) throw 0;
    const profile = config.objects.get(config.users.get(claims.sub));
    if (!profile) throw new Problem(403, "Учётная запись не привязана к объекту.");
    return {
      profile,
      actor: {
        id: claims.sub,
        name: typeof claims.name === "string" && claims.name.trim() ? claims.name : claims.sub
      }
    };
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw unauthorized();
  }
}

function sourceAuth(req, config, source) {
  const secret = config.keys[source];
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  const a = Buffer.from(secret || ""),
    b = Buffer.from(token || "");
  if (!secret || !token || a.length !== b.length || !timingSafeEqual(a, b)) throw unauthorized();
}

async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new Problem(415,
    "Требуется JSON.");
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 29 * 1024 * 1024) throw new Problem(413, "Слишком большой файл.");
    parts.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(parts).toString());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw 0;
    return data;
  } catch {
    throw new Problem(400, "Некорректный JSON.");
  }
}

function sendFile(res, bytes, filename, type, download = false) {
  const safeName = encodeURIComponent(filename.toWellFormed()).replace(/['()*]/g, c => "%" + c.charCodeAt(0)
    .toString(16));
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Disposition": (download ? "attachment" : "inline") + "; filename*=UTF-8''" + safeName,
    "Cache-Control": "private, no-store"
  });
  res.end(bytes);
}

export function handler({
  registry,
  config,
  root,
  demo = false
}) {
  return async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "same-origin");
      const url = new URL(req.url, "http://localhost");
      const path = decodeURIComponent(url.pathname);
      if (!demo && path === "/runtime.json") return json(res, 200, {
        mode: "live"
      });
      if (!demo && path.startsWith("/api/")) {
        if (req.method !== "GET" && (req.headers["sec-fetch-site"] === "cross-site" ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)))
        throw new Problem(403, "Запрос с другого сайта отклонён.");
        const resource = path.split("/").slice(2);
        const [api, id, action, extra] = resource;
        if (api === "sources" && Object.hasOwn(directions, id)) {
          sourceAuth(req, config, id);
          if (action === "events" && !extra && req.method === "GET") return json(res, 200, registry
            .events(id, Number(url.searchParams.get("after") || 0)));
          if (action === "attachments" && extra && req.method === "GET") {
            const file = registry.attachment(extra, id, true);
            return sendFile(res, file.file, file.filename, "application/octet-stream", true);
          }
          if ((action === "deliveries" && req.method === "POST") || (action === "cases" && req.method ===
              "PATCH")) {
            const packet = await body(req);
            const profile = config.objects.get(packet.recipient);
            if (!profile) throw new Problem(422, "Получатель отсутствует в справочнике.");
            const result = action === "deliveries" ? registry.deliver(profile, id, packet) : registry
              .updateCase(profile, id, packet.case);
            return json(res, result.created ? 201 : 200, result);
          }
          throw absent();
        }
        const {
          profile,
          actor
        } = session(req, config);
        if (api === "cabinet" && !id && req.method === "GET") return json(res, 200, {
          profile: {
            ...profile,
            actor: actor.name
          },
          cases: registry.list(profile.id)
        });
        if (api === "documents" && id && !extra) {
          if (action === "pdf" && req.method === "GET") return sendFile(res, registry.pdf(profile.id, id),
            "SAQ-" + id + ".pdf", "application/pdf", url.searchParams.has("download"));
          if (action === "acknowledge" && req.method === "POST") {
            await body(req);
            return json(res, 200, registry.acknowledge(profile.id, id, actor));
          }
          if (action === "responses" && req.method === "POST") return json(res, 200, registry.reply(
            profile.id, id, actor, await body(req)));
        }
        if (api === "attachments" && id && !action && req.method === "GET") {
          const file = registry.attachment(id, profile.id);
          return sendFile(res, file.file, file.filename, "application/octet-stream", true);
        }
        throw absent();
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new Problem(405,
        "Метод не поддерживается.");
      const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(root + sep) || !Object.hasOwn(mime, extname(file))) throw absent();
      let data;
      try {
        data = await readFile(file);
      } catch {
        throw absent();
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(file)],
        "Content-Length": data.length,
        "Cache-Control": "no-cache"
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (!(error instanceof Problem)) console.error(error.message);
      json(res, error.status || 500, {
        error: error.status ? error.message : "Не удалось выполнить операцию."
      });
    }
  };
}
