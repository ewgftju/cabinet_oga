import {
  auditKinds,
  profKinds
} from "../web/catalog.js";

const profile = (id, sector, name, actor, category = null, region = "г. Астана", idType = "bin") =>
  ({
    id,
    sector,
    name,
    actor,
    category,
    region,
    idType
  });

export const profiles = [
  profile("000000000101", "state", "ГУ «Управление городской инфраструктуры»", "Алина Сеитова"),
  profile("000000000102", "quasi", "АО «Городские сети»", "Данияр Оразов"),
  profile("000000000103", "private", "ТОО «Аудит Сараптама»", "Айдана Жакупова", "АО"),
  profile("000000000104", "private", "ПАО «Бірлік Аудит»", "Асан Маратов", "ПАО"),
  profile("000000000105", "private", "Оценщик А. Нурова", "Алия Нурова", "ОЦ", "г. Алматы", "iin"),
  profile("000000000106", "private", "Палата оценщиков «Өлшем»", "Марат Алиев", "ПО"),
  profile("000000000107", "private", "ТОО «Арна Қаржы»", "Сауле Ахметова", "ОПИ"),
  profile("000000000108", "private", "ПОБ «Есеп»", "Айгуль Нурова", "ПОБ"),
  profile("000000000109", "private", "Центр сертификации «Білім»", "Азамат Нуров", "ОПСБ"),
];
const issuers = {
  vga: "Департамент внутреннего государственного аудита",
  sva: "Служба внутреннего аудита",
  prof: "Комитет внутреннего государственного аудита",
};
const kindsAudit = Object.keys(auditKinds);
const kindsProf = Object.keys(profKinds);
const prefix = {
  vga: "ВГА",
  sva: "СВА",
  prof: "ПК"
};
const dayAt = (date, offset) => new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10);

function inspection(ownerIndex, source, year, seq, title, start, end, status, kinds, unread = [], revision =
  false) {
  const p = profiles[ownerIndex];
  const n = String(seq).padStart(3, "0");
  const id = [source, p.id, year, n].join("-");
  const number = [prefix[source], year, n].join("-");
  const items = [{
      id: "1",
      text: "Дополнить внутренний регламент и представить утверждённую редакцию.",
      deadline: dayAt(end, 30)
    },
    {
      id: "2",
      text: "Представить подтверждение устранения замечаний по учёту документов.",
      deadline: dayAt(end, 40)
    },
  ];
  const documents = kinds.map((kind, index) => {
    const sentDay = source === "prof" && kind === "notice" ? dayAt(start, -31) :
      ["prescription", "conclusion", "result-act", "objection-result"].includes(kind) ? end :
      kind === "report" ? dayAt(end, -1) : dayAt(start, Math.min(index, 4));
    const code = String(index + 1).padStart(2, "0");
    return {
      id: id + "-d" + code + "-v1",
      sourceId: "d" + code,
      kind,
      version: 1,
      number: n + "/" + code,
      sentAt: sentDay + "T05:30:00.000Z",
      receipt: unread.includes(kind) ? null : {
        actor: p.actor,
        at: sentDay + "T07:45:00.000Z"
      },
      points: kind === "prescription" && source === "prof" ? items : [],
      responses: [],
    };
  });
  if (revision) {
    const first = documents.find((doc) => doc.kind === "request");
    if (first) documents.push({
      ...first,
      id: first.id.replace(/v1$/, "v2"),
      version: 2,
      receipt: null,
      sentAt: dayAt(start, 6) + "T08:10:00.000Z"
    });
  }
  return {
    id,
    owner: p.id,
    source,
    number,
    title,
    start,
    end,
    status,
    issuer: issuers[source],
    category: p.category,
    documents
  };
}

export const cases = [
  inspection(0, "vga", 2026, 42, "Аудит использования бюджетных средств", "2026-10-26", "2026-11-20",
    "active", ["instruction", "request", "additional"], ["additional"], true),
  inspection(0, "sva", 2026, 17, "Аудит государственных закупок", "2026-08-03", "2026-08-21", "execution",
    kindsAudit, ["prescription"]),
  inspection(0, "vga", 2025, 31, "Аудит использования бюджетных средств", "2025-09-08", "2025-09-26",
    "closed", kindsAudit),
  inspection(0, "sva", 2025, 8, "Аудит управления активами", "2025-04-07", "2025-04-25", "closed", [
    "instruction", "report", "conclusion"
  ]),
  inspection(0, "vga", 2024, 24, "Аудит исполнения бюджетных программ", "2024-06-03", "2024-06-21",
    "closed", ["instruction", "request", "report", "conclusion"]),
  inspection(1, "sva", 2026, 11, "Аудит закупок и исполнения договоров", "2026-09-07", "2026-09-25",
    "execution", kindsAudit, ["prescription", "conclusion"]),
  inspection(1, "vga", 2025, 19, "Аудит использования государственных активов", "2025-05-05", "2025-05-23",
    "closed", kindsAudit),
];
const profTopics = {
  "АО": "Проверка деятельности аудиторской организации",
  "ПАО": "Контроль деятельности профессиональной аудиторской организации",
  "ОЦ": "Контроль оценочной деятельности",
  "ПО": "Контроль деятельности палаты оценщиков",
  "ОПИ": "Контроль ведения учёта и финансовой отчётности",
  "ПОБ": "Контроль деятельности профессиональной организации бухгалтеров",
  "ОПСБ": "Контроль профессиональной сертификации бухгалтеров",
};
for (const [index, p] of profiles.entries()) {
  if (p.sector !== "private") continue;
  const current = index === 2 ? kindsProf.filter((kind) => kind !== "refusal-protocol") :
    ["notice", "appointment-act", "checklist", "article-155"];
  cases.push(inspection(index, "prof", 2026, 10 + index, profTopics[p.category], "2026-10-05", "2026-10-23",
    index === 2 ? "execution" : "active", current, current.slice(-2)));
  if (index <= 4) {
    const archived = ["notice", "appointment-act", "checklist", "article-155", "result-act", "prescription"];
    if (index === 3) archived.splice(4, 0, "refusal-protocol");
    cases.push(inspection(index, "prof", 2025, 6 + index, profTopics[p.category], "2025-04-07", "2025-04-25",
      "closed", archived));
  }
}
