import {
  DatabaseSync
} from "node:sqlite";
import {
  createHash,
  randomUUID
} from "node:crypto";
import {
  caseStatuses,
  documentTitle,
  eligibleDirections,
  localDay
} from "../web/catalog.js";

export class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireValue(ok, message) {
  if (!ok) throw new Problem(400, message);
}

function text(value, max = 500) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function instant(value) {
  return typeof value === "string" && day(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date
      .parse(value));
}

function decodeBytes(value, limit) {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= Math.ceil(limit / 3) * 4 &&
    /^[a-zA-Z0-9+/]+={0,2}$/.test(value), "Некорректное вложение.");
  const bytes = Buffer.from(value, "base64");
  requireValue(bytes.length <= limit && bytes.toString("base64") === value, "Некорректное вложение.");
  return bytes;
}

function caseData(data) {
  const c = data ?? {};
  requireValue(text(c.id, 160) && text(c.number, 100) && text(c.title) && text(c.issuer) &&
    positive(c.revision) && day(c.start) && (c.end == null || (day(c.end) && c.end >= c.start)) &&
    Object.hasOwn(caseStatuses, c.status), "Проверьте реквизиты и редакцию мероприятия.");
  return {
    number: c.number,
    title: c.title,
    issuer: c.issuer,
    start: c.start,
    end: c.end || null,
    status: c.status
  };
}

function fileHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
const missing = () => new Problem(404, "Запись не найдена в вашем кабинете.");

export class Registry {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
        revision INTEGER NOT NULL, category TEXT, meta TEXT NOT NULL, UNIQUE(owner,source,source_id));
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES inspections(id), source_id TEXT NOT NULL,
        version INTEGER NOT NULL, meta TEXT NOT NULL, hash TEXT NOT NULL, pdf BLOB NOT NULL,
        UNIQUE(case_id,source_id,version));
      CREATE TABLE IF NOT EXISTS receipts (
        document_id TEXT PRIMARY KEY REFERENCES documents(id), actor_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL, point_id TEXT NOT NULL, measures TEXT NOT NULL,
        completed TEXT NOT NULL, filename TEXT NOT NULL, file BLOB NOT NULL, hash TEXT NOT NULL,
        UNIQUE(document_id,actor_id,request_id));
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY, source TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_source ON events(source,seq);
    `);
  }

  transaction(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertCase(profile, source, input, meta, allowCreate) {
    const serialized = JSON.stringify(meta);
    const row = this.db.prepare("SELECT * FROM inspections WHERE owner=? AND source=? AND source_id=?").get(
      profile.id, source, input.id);
    if (!row && !allowCreate) throw missing();
    if (!row) {
      const id = randomUUID();
      this.db.prepare("INSERT INTO inspections VALUES(?,?,?,?,?,?,?)").run(id, profile.id, source, input.id,
        input.revision, profile.category || null, serialized);
      return id;
    }
    if (input.revision === row.revision && serialized !== row.meta) throw new Problem(409,
      "Реквизиты этой редакции мероприятия уже получены.");
    if (input.revision > row.revision) this.db.prepare(
      "UPDATE inspections SET meta=?, revision=? WHERE id=?").run(serialized, input.revision, row.id);
    return row.id;
  }

  updateCase(profile, source, input) {
    const meta = caseData(input);
    return this.transaction(() => ({
      id: this.upsertCase(profile, source, input, meta, false)
    }));
  }

  deliver(profile, source, packet) {
    const c = packet.case,
      submitted = packet.document ?? {};
    // В СВА поручение и требование имеют собственные коды в матрице форм.
    const aliases = source === "sva" ? {
      assignment: "instruction",
      requirement: "request"
    } : {};
    const d = {
      ...submitted,
      kind: Object.hasOwn(aliases, submitted.kind) ? aliases[submitted.kind] : submitted.kind
    };
    const info = caseData(c);
    requireValue(packet.audience === "subject" && packet.status === "sent" && packet.recipient === profile
      .id, "Ожидается отправка конкретному объекту.");
    requireValue(documentTitle(source, d.kind) && text(d.id, 160) && text(d.number, 100) && positive(d
      .version) && instant(d.sentAt), "Недопустимый вид или реквизиты документа.");
    requireValue(d.points == null || Array.isArray(d.points), "Некорректные пункты предписания.");
    const points = (d.points ?? []).map((p) => {
      requireValue(p && text(p.id, 80) && text(p.text, 3000) && day(p.deadline),
        "Проверьте пункт предписания.");
      return {
        id: p.id,
        text: p.text,
        deadline: p.deadline
      };
    });
    requireValue(new Set(points.map(p => p.id)).size === points.length && (!points.length || (source ===
      "prof" && d.kind === "prescription")), "Недопустимые пункты предписания.");
    const pdf = decodeBytes(d.pdfBase64, 20 * 1024 * 1024);
    requireValue(pdf.toString("ascii", 0, 5) === "%PDF-" && pdf.subarray(-1024).includes("%%EOF"),
      "Требуется печатная форма в PDF.");
    const serialized = JSON.stringify({
      kind: d.kind,
      number: d.number,
      sentAt: new Date(d.sentAt).toISOString(),
      points
    });
    const hash = fileHash(pdf);
    return this.transaction(() => {
      const historical = this.db.prepare(
        "SELECT id FROM inspections WHERE owner=? AND source=? AND source_id=?").get(profile.id,
        source, c.id);
      if (!historical && !eligibleDirections(profile).includes(source)) throw new Problem(422,
        "Направление не соответствует карточке объекта.");
      const caseId = this.upsertCase(profile, source, c, info, true);
      const old = this.db.prepare(
        "SELECT id,meta,hash FROM documents WHERE case_id=? AND source_id=? AND version=?").get(
        caseId, d.id, d.version);
      if (old) {
        if (old.meta !== serialized || old.hash !== hash) throw new Problem(409,
          "Для изменённой печатной формы требуется новая версия.");
        return {
          caseId,
          documentId: old.id,
          created: false
        };
      }
      const prior = this.db.prepare(
        "SELECT meta FROM documents WHERE case_id=? AND source_id=? LIMIT 1").get(caseId, d.id);
      if (prior && JSON.parse(prior.meta).kind !== d.kind) throw new Problem(409,
        "У документа изменился вид.");
      const id = randomUUID();
      this.db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?)").run(id, caseId, d.id, d.version,
        serialized, hash, pdf);
      return {
        caseId,
        documentId: id,
        created: true
      };
    });
  }

  list(owner) {
    const cases = this.db.prepare("SELECT * FROM inspections WHERE owner=?").all(owner);
    const documents = this.db.prepare(`SELECT d.id,d.case_id,d.source_id,d.version,d.meta,r.actor,r.at
      FROM documents d JOIN inspections c ON c.id=d.case_id LEFT JOIN receipts r ON r.document_id=d.id
      WHERE c.owner=? ORDER BY d.rowid`).all(owner);
    const replies = this.db.prepare(
      `SELECT r.id,r.document_id,r.point_id AS pointId,r.measures,r.completed,r.actor,r.at,r.filename
      FROM replies r JOIN documents d ON d.id=r.document_id JOIN inspections c ON c.id=d.case_id WHERE c.owner=? ORDER BY r.rowid`).all(
      owner);
    const replyMap = Map.groupBy(replies, r => r.document_id);
    const docMap = Map.groupBy(documents, d => d.case_id);
    return cases.map(c => ({
      id: c.id,
      source: c.source,
      category: c.category,
      ...JSON.parse(c.meta),
      documents: (docMap.get(c.id) || []).map(d => ({
        id: d.id,
        sourceId: d.source_id,
        version: d.version,
        ...JSON.parse(d.meta),
        receipt: d.at ? {
          actor: d.actor,
          at: d.at
        } : null,
        responses: replyMap.get(d.id) || [],
      }))
    }));
  }

  findDoc(owner, id) {
    const entry = this.db.prepare(`SELECT d.id,d.meta,d.source_id,d.version,c.source,c.owner,c.source_id AS original_case
      FROM documents d JOIN inspections c ON c.id=d.case_id WHERE c.owner=? AND d.id=?`).get(owner, id);
    if (!entry) throw missing();
    return entry;
  }

  pdf(owner, id) {
    const row = this.db.prepare(
        "SELECT d.pdf FROM documents d JOIN inspections c ON c.id=d.case_id WHERE d.id=? AND c.owner=?")
      .get(id, owner);
    if (!row) throw missing();
    return Buffer.from(row.pdf);
  }

  publish(entry, type, data) {
    const payload = {
      type,
      recipient: entry.owner,
      caseId: entry.original_case,
      documentId: entry.source_id,
      version: entry.version,
      ...data
    };
    this.db.prepare("INSERT INTO events(source,payload) VALUES(?,?)").run(entry.source, JSON.stringify(
      payload));
  }

  acknowledge(owner, id, actor) {
    return this.transaction(() => {
      const entry = this.findDoc(owner, id);
      const prior = this.db.prepare("SELECT actor,at FROM receipts WHERE document_id=?").get(id);
      if (prior) return prior;
      const receipt = {
        actor: actor.name,
        at: new Date().toISOString()
      };
      this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?)").run(id, actor.id, receipt.actor, receipt
        .at);
      this.publish(entry, "acknowledged", {
        ...receipt,
        actorId: actor.id
      });
      return receipt;
    });
  }

  reply(owner, id, actor, input) {
    const entry = this.findDoc(owner, id);
    const doc = JSON.parse(entry.meta);
    requireValue(entry.source === "prof" && doc.kind === "prescription" && doc.points.some(p => p.id ===
      input.pointId), "Пункт предписания не найден.");
    requireValue(text(input.requestId, 100) && text(input.measures, 8000) && day(input.completed) && input
      .completed <= localDay() && text(input.filename, 255), "Заполните меры, дату исполнения и вложение."
      );
    const blob = decodeBytes(input.fileBase64, 8 * 1024 * 1024);
    const hash = fileHash(blob);
    return this.transaction(() => {
      const prior = this.db.prepare(
        "SELECT * FROM replies WHERE document_id=? AND actor_id=? AND request_id=?").get(id, actor.id,
        input.requestId);
      if (prior) {
        if (prior.hash !== hash || prior.point_id !== input.pointId || prior.completed !== input
          .completed || prior.filename !== input.filename || prior.measures !== input.measures.trim())
          throw new Problem(409, "Ответ с таким идентификатором уже зарегистрирован.");
        return {
          id: prior.id
        };
      }
      const replyId = randomUUID();
      const at = new Date().toISOString();
      this.db.prepare("INSERT INTO replies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(replyId, id, input
        .requestId, actor.id, actor.name, at, input.pointId, input.measures.trim(), input.completed,
        input.filename, blob, hash);
      this.publish(entry, "execution-response", {
        id: replyId,
        at,
        actor: actor.name,
        actorId: actor.id,
        pointId: input.pointId,
        measures: input.measures.trim(),
        completed: input.completed,
        filename: input.filename
      });
      return {
        id: replyId
      };
    });
  }

  attachment(id, who, sourceAccess = false) {
    const scope = sourceAccess ? "c.source" : "c.owner";
    const res = this.db.prepare(
      `SELECT r.filename,r.file FROM replies r JOIN documents d ON d.id=r.document_id JOIN inspections c ON c.id=d.case_id WHERE r.id=? AND ${scope}=?`
      ).get(id, who);
    if (!res) throw missing();
    return res;
  }

  events(source, after) {
    requireValue(Number.isSafeInteger(after) && after >= 0, "Неверный курсор.");
    return this.db.prepare("SELECT seq,payload FROM events WHERE source=? AND seq>? ORDER BY seq LIMIT 100")
      .all(source, after).map(e => ({
        seq: e.seq,
        ...JSON.parse(e.payload)
      }));
  }
}
