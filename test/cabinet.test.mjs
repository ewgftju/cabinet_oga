import assert from "node:assert/strict";
import {
  after,
  before,
  test
} from "node:test";
import {
  createServer
} from "node:http";
import {
  generateKeyPairSync,
  sign
} from "node:crypto";
import {
  mkdtemp,
  rm,
  readFile
} from "node:fs/promises";
import {
  tmpdir
} from "node:os";
import {
  join,
  resolve
} from "node:path";
import {
  brotliDecompressSync
} from "node:zlib";
import {
  Registry
} from "../server/store.mjs";
import {
  handler,
  settings
} from "../server/http.mjs";
import {
  auditKinds,
  documentTitle,
  eligibleDirections
} from "../web/catalog.js";
import {
  cases,
  profiles
} from "../demo/scenarios.mjs";

const [state, quasi, privateOrg] = profiles;
const issuer = "https://idp.example/saq",
  audience = "oga",
  keys = {
    vga: "v".repeat(40),
    sva: "s".repeat(40),
    prof: "p".repeat(40)
  };
const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048
});
const auth = (sub, options = {}) => {
  const exp = Math.floor(Date.now() / 1000) + 120;
  const parts = [{
    alg: "RS256",
    typ: "JWT"
  }, {
    sub,
    name: sub,
    iss: issuer,
    aud: audience,
    exp,
    ...options
  }].map(v => Buffer.from(JSON.stringify(v)).toString("base64url"));
  return parts.join(".") + "." + sign("RSA-SHA256", Buffer.from(parts.join(".")), pair.privateKey).toString(
    "base64url");
};
let db, server, url, folder, filename, prints, sample;
before(async () => {
  folder = await mkdtemp(join(tmpdir(), "oga-test-"));
  filename = join(folder, "registry.sqlite");
  db = new Registry(filename);
  const directory = {
    objects: [state, quasi, privateOrg],
    representatives: {
      alice: state.id,
      bob: quasi.id,
      owner: privateOrg.id
    }
  };
  const config = settings({
    OGA_ISSUER: issuer,
    OGA_AUDIENCE: audience,
    OGA_SOURCE_VGA: keys.vga,
    OGA_SOURCE_SVA: keys.sva,
    OGA_SOURCE_PROF: keys.prof
  }, directory, pair.publicKey.export({
    type: "spki",
    format: "pem"
  }));
  server = createServer(handler({
    registry: db,
    config,
    root: resolve("web")
  }));
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  url = "http://127.0.0.1:" + server.address().port;
  prints = JSON.parse(brotliDecompressSync(await readFile(new URL("../demo/prints.br", import.meta
    .url))));
  sample = Object.values(prints)[0];
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(ok => server.close(ok));
  }
  db?.db.close();
  if (folder) await rm(folder, {
    recursive: true,
    force: true
  });
});
const call = (path, token, method = "GET", data, extra = {}) => fetch(url + path, {
  method,
  headers: {
    ...(token ? {
      Authorization: "Bearer " + token
    } : {}),
    ...(data ? {
      "Content-Type": "application/json"
    } : {}),
    ...extra
  },
  body: data ? JSON.stringify(data) : undefined
});

function packet(id, recipient = state.id, kind = "instruction") {
  return {
    recipient,
    status: "sent",
    audience: "subject",
    case: {
      id,
      revision: 1,
      number: "№ " + id,
      title: "Проверка",
      issuer: "Орган",
      start: "2026-01-10",
      end: "2026-01-22",
      status: "active"
    },
    document: {
      id: "doc-01",
      version: 1,
      kind,
      number: "01",
      sentAt: "2026-01-10T05:00:00Z",
      pdfBase64: sample
    }
  };
}
const send = (direction, packet) => call("/api/sources/" + direction + "/deliveries", keys[direction], "POST",
  packet);

test("реестр принимает только адресные отправки допустимого вида и сектора", async () => {
  for (const [src, recipient, kind] of [
      ["prof", state.id, "notice"],
      ["sva", privateOrg.id, "report"],
      ["vga", privateOrg.id, "report"],
      ["prof", quasi.id, "notice"]
    ]) {
    assert.equal((await send(src, packet("wrong-sector", recipient, kind))).status, 422);
  }
  for (const source of ["vga", "sva"]) {
    for (const kind of ["quality1", "plan", "report-draft", "evidence"]) assert.equal((await send(
      source, packet("internal", state.id, kind))).status, 400);
    for (const kind of Object.keys(auditKinds)) assert.equal((await send(source, packet("allow-" + kind,
      state.id, kind))).status, 201);
  }
  assert.equal((await send("vga", packet("internal-assignment", state.id, "assignment"))).status, 400);
  for (const kind of ["assignment", "requirement"]) assert.equal((await send("sva", packet("sva-code-" +
    kind, state.id, kind))).status, 201);
  for (const changes of [{
      status: "draft"
    }, {
      audience: "ersop"
    }, {
      recipient: "000000000999"
    }]) assert.ok((await send("vga", {
    ...packet("draft"),
    ...changes
  })).status >= 400);
  assert.equal((await send("prof", packet("internal-prof", privateOrg.id, "card-1-p"))).status, 400);
  const bad = packet("bad-print");
  bad.document.pdfBase64 = Buffer.from("<html>").toString("base64");
  assert.equal((await send("vga", bad)).status, 400);
});
test("повторные проверки, версии, повторная доставка и независимые отметки", async () => {
  const p = packet("case-2026");
  const first = await send("vga", p);
  assert.equal(first.status, 201);
  const original = await first.json();
  const archived = packet("case-2025");
  Object.assign(archived.case, {
    start: "2025-01-10",
    end: "2025-01-22",
    status: "closed"
  });
  const previous = await (await send("vga", archived)).json();
  assert.notEqual(original.caseId, previous.caseId);
  assert.notEqual(original.documentId, previous.documentId);
  const repeat = await send("vga", p);
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), {
    ...original,
    created: false
  });
  const conflict = structuredClone(p);
  conflict.document.number = "02";
  assert.equal((await send("vga", conflict)).status, 409);
  const changed = structuredClone(p);
  changed.document.pdfBase64 = Object.values(prints)[1];
  assert.equal((await send("vga", changed)).status, 409);
  changed.document.version = 2;
  const version2 = await (await send("vga", changed)).json();
  assert.notEqual(version2.documentId, original.documentId);
  const token = auth("alice");
  const id = original.documentId;
  const pdf = await call("/api/documents/" + id + "/pdf", token);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), Buffer.from(sample, "base64"));
  const reads = await Promise.all([1, 2, 3].map(() => call("/api/documents/" + id + "/acknowledge",
    token, "POST", {}).then(r => r.json())));
  assert.deepEqual(reads[0], reads[1]);
  assert.deepEqual(reads[1], reads[2]);
  assert.equal(reads[0].actor, "alice");
  assert.equal((await call("/api/documents/" + id + "/pdf", auth("bob"))).status, 404);
  assert.equal((await call("/api/documents/" + id + "/acknowledge", auth("bob"), "POST", {})).status,
    404);
  const newCase = {
    ...p.case,
    revision: 2,
    status: "closed"
  };
  assert.equal((await call("/api/sources/vga/cases", keys.vga, "PATCH", {
    case: newCase,
    recipient: state.id
  })).status, 200);
  assert.equal((await send("vga", p)).status, 200);
  const secondStore = new Registry(filename);
  try {
    const list = secondStore.list(state.id);
    const item = list.find(c => c.id === original.caseId);
    assert.equal(item.status, "closed");
    assert.equal(item.documents.find(d => d.id === version2.documentId).receipt, null);
    assert.equal(item.documents.find(d => d.id === id).receipt.actor, "alice");
    assert.equal(list.find(c => c.id === previous.caseId).documents[0].receipt, null);
  } finally {
    secondStore.db.close();
  }
  const feed = await (await call("/api/sources/vga/events", keys.vga)).json();
  assert.equal(feed.filter(e => e.caseId === "case-2026").length, 1);
  assert.equal((await (await call("/api/sources/vga/events?after=" + feed.at(-1).seq, keys.vga)).json())
    .length, 0);
});
test("дело с общим номером из другого направления или для другого объекта обособлено", async () => {
  const a = await (await send("vga", packet("shared", state.id))).json();
  const b = await (await send("sva", packet("shared", state.id))).json();
  const c = await (await send("vga", packet("shared", quasi.id))).json();
  assert.equal(new Set([a.caseId, b.caseId, c.caseId]).size, 3);
  const owner = await (await call("/api/cabinet?recipient=" + state.id, auth("bob"))).json();
  assert.equal(owner.profile.id, quasi.id);
  assert.ok(!owner.cases.some(row => row.id === a.caseId));
});
test("профконтроль принимает ответ и вложение по конкретному пункту и предоставляет их источнику",
async () => {
  const input = packet("prof-case", privateOrg.id, "prescription");
  input.document.points = [{
    id: "a",
    text: "Представить документы",
    deadline: "2026-11-20"
  }];
  const doc = await (await send("prof", input)).json();
  const token = auth("owner");
  const response = {
    requestId: "unique-reply",
    pointId: "a",
    measures: "Документы представлены",
    completed: "2025-01-01",
    filename: "подтверждение.pdf",
    fileBase64: sample
  };
  const path = "/api/documents/" + doc.documentId + "/responses";
  assert.equal((await call(path, token, "POST", {
    ...response,
    pointId: "other"
  })).status, 400);
  assert.equal((await call(path, token, "POST", {
    ...response,
    completed: "2099-01-01"
  })).status, 400);
  const reply = await (await call(path, token, "POST", response)).json();
  assert.ok(reply.id);
  assert.equal((await (await call(path, token, "POST", response)).json()).id, reply.id);
  assert.equal((await call(path, token, "POST", {
    ...response,
    measures: "Другое"
  })).status, 409);
  const feed = await (await call("/api/sources/prof/events", keys.prof)).json();
  assert.equal(feed.filter(e => e.id === reply.id).length, 1);
  assert.equal((await call("/api/attachments/" + reply.id, auth("bob"))).status, 404);
  assert.equal((await call("/api/sources/vga/attachments/" + reply.id, keys.vga)).status, 404);
  const contents = await call("/api/sources/prof/attachments/" + reply.id, keys.prof);
  assert.equal(contents.status, 200);
  assert.equal(Buffer.from(await contents.arrayBuffer()).toString("base64"), sample);
});
test("границы демонстрационных профилей и авторизации", async () => {
  assert.equal((await call("/api/cabinet")).status, 401);
  assert.equal((await call("/api/cabinet", auth("unknown"))).status, 403);
  for (const claims of [{
      aud: "other"
    }, {
      iss: "other"
    }, {
      exp: 1
    }, {
      nbf: 4999999999
    }]) assert.equal((await call("/api/cabinet", auth("alice", claims))).status, 401);
  const cookie = await call("/api/cabinet", null, "GET", null, {
    Cookie: "saq_access=" + auth("alice")
  });
  assert.equal(cookie.status, 200);
  assert.equal((await call("/api/sources/vga/events", keys.sva)).status, 401);
  assert.equal((await call("/demo.json", auth("alice"))).status, 404);
  assert.equal((await call("/api/documents/fake/acknowledge", auth("alice"), "POST", {}, {
    Origin: "https://other.example"
  })).status, 403);
  const fixtureIds = cases.flatMap(c => c.documents.map(d => d.id));
  assert.equal(new Set(fixtureIds).size, fixtureIds.length);
  assert.deepEqual(Object.keys(prints).sort(), fixtureIds.sort());
  for (const c of cases) {
    assert.ok(eligibleDirections(profiles.find(p => p.id === c.owner)).includes(c.source));
    for (const d of c.documents) {
      assert.ok(documentTitle(c.source, d.kind));
      assert.equal(Buffer.from(prints[d.id], "base64").subarray(0, 5).toString(), "%PDF-");
    }
  }
});
