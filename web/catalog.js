export const directions = {
  vga: {
    short: "ВГА",
    name: "Внутренний государственный аудит"
  },
  sva: {
    short: "СВА",
    name: "Служба внутреннего аудита"
  },
  prof: {
    short: "ПК",
    name: "Профилактический контроль"
  },
};

export const sectors = {
  state: "Государственный сектор",
  quasi: "Квазигосударственный сектор",
  private: "Частный сектор",
};

export const professions = {
  "АО": "Аудиторская организация",
  "ПАО": "Профессиональная аудиторская организация",
  "ОПИ": "Организация публичного интереса",
  "ПОБ": "Профессиональная организация бухгалтеров",
  "ОПСБ": "Организация по профессиональной сертификации бухгалтеров",
  "ПО": "Палата оценщиков",
  "ОЦ": "Оценщик",
};

export const auditKinds = {
  instruction: "Поручение",
  additional: "Дополнительное поручение",
  report: "Аудиторский отчёт",
  conclusion: "Аудиторское заключение",
  prescription: "Предписание",
  request: "Требование",
};

export const profKinds = {
  notice: "Уведомление о начале профилактического контроля",
  "appointment-act": "Акт о назначении профилактического контроля",
  checklist: "Проверочный лист",
  "article-155": "Права и обязанности субъекта контроля (статья 155)",
  "additional-act": "Дополнительный акт о продлении срока",
  "refusal-protocol": "Протокол об отказе в принятии акта",
  "result-act": "Акт о результатах профилактического контроля",
  "objection-result": "Результаты рассмотрения возражения",
  prescription: "Предписание об устранении выявленных нарушений",
};

export const caseStatuses = {
  active: "В работе",
  execution: "На исполнении",
  closed: "Завершена"
};

export function eligibleDirections(profile) {
  if (profile.sector === "state" || profile.sector === "quasi") return ["vga", "sva"];
  if (profile.sector === "private" && Object.hasOwn(professions, profile.category)) return ["prof"];
  return [];
}

export function documentTitle(source, kind) {
  const kinds = source === "prof" ? profKinds : auditKinds;
  return Object.hasOwn(kinds, kind) ? kinds[kind] : undefined;
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Almaty"
});
const stampFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Almaty"
});
export const dateText = (value) => dateFormat.format(new Date(value));
export const stampText = (value) => stampFormat.format(new Date(value));
export const localDay = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Almaty",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());
export const periodText = (item) => item.end ? dateText(item.start) + " – " + dateText(item.end) : "с " +
  dateText(item.start);
export const idLabel = (profile) => profile.idType === "iin" ? "ИИН" : "БИН";
export const pendingCount = (item) => item.documents.filter((doc) => !doc.receipt).length;
