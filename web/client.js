let runtime, fixtures, db;
const profileKey = "saq.oga.demo.profile";
export let isDemo = false;
export let demoProfiles = [];

async function request(path, options) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...options
  });
  if (!res.ok) {
    const problem = await res.json().catch(() => ({}));
    throw Error(problem.error || "Не удалось загрузить данные. Попробуйте ещё раз.");
  }
  return res;
}
const post = (path, data) => request(path, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(data)
}).then(r => r.json());

function storage() {
  if (!db) db = new Promise((resolve, reject) => {
    const req = indexedDB.open("saq-oga-demo-v1", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("receipts");
      req.result.createObjectStore("responses", {
        keyPath: "id"
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(Error("Браузер не разрешил сохранить данные демонстрационного кабинета."));
  });
  return db;
}
async function transaction(name, mode, work) {
  const store = await storage();
  return new Promise((resolve, reject) => {
    const tx = store.transaction(name, mode);
    const result = work(tx.objectStore(name));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = tx.onabort = () => reject(Error(
      "Данные не сохранены. Проверьте доступное место в браузере."));
  });
}

let active;
export async function initialize() {
  runtime = await (await request("/runtime.json")).json();
  if (runtime.mode !== "demo" && runtime.mode !== "live") throw Error("Неизвестный режим кабинета.");
  isDemo = runtime.mode === "demo";
  if (isDemo) {
    fixtures = await (await request("/demo.json")).json();
    demoProfiles = fixtures.profiles;
    let selected;
    try {
      selected = sessionStorage.getItem(profileKey);
    } catch {}
    active = demoProfiles.find(p => p.id === selected) || demoProfiles[0];
  }
  return loadCabinet();
}
export function switchProfile(id) {
  const profile = isDemo && demoProfiles.find(p => p.id === id);
  if (!profile) throw Error("Карточка объекта не найдена.");
  active = profile;
  try {
    sessionStorage.setItem(profileKey, id);
  } catch {}
}
export async function loadCabinet() {
  if (!isDemo) return (await request("/api/cabinet")).json();
  const profile = active;
  const cases = structuredClone(fixtures.cases.filter(c => c.owner === profile.id));
  const [entries, responses] = await Promise.all([
    transaction("receipts", "readonly", s => s.getAll()),
    transaction("responses", "readonly", s => s.getAll()),
  ]);
  const receipts = new Map(entries.filter(r => r.owner === profile.id).map(r => [r.doc, r.receipt]));
  const grouped = new Map();
  for (const {
      fileBase64,
      owner,
      doc,
      ...response
    }
    of responses) {
    if (owner !== profile.id) continue;
    if (!grouped.has(doc)) grouped.set(doc, []);
    grouped.get(doc).push(response);
  }
  for (const c of cases)
    for (const d of c.documents) {
      d.receipt = receipts.get(d.id) || d.receipt;
      d.responses = grouped.get(d.id) || [];
    }
  return {
    profile,
    cases
  };
}

function demoDoc(id) {
  for (const c of fixtures.cases)
    if (c.owner === active.id) {
      const d = c.documents.find(d => d.id === id);
      if (d) return d;
    }
  throw Error("Документ не найден в кабинете объекта.");
}
export async function pdf(id) {
  if (isDemo) demoDoc(id);
  const res = await request(isDemo ? "/prints/" + encodeURIComponent(id) + ".pdf" : "/api/documents/" +
    encodeURIComponent(id) + "/pdf");
  if (!res.headers.get("content-type")?.includes("application/pdf")) throw Error(
    "Печатная форма недоступна.");
  const blob = await res.blob();
  if ((await blob.slice(0, 5).text()) !== "%PDF-") throw Error("Печатная форма повреждена.");
  return URL.createObjectURL(blob);
}
export async function acknowledge(id) {
  if (!isDemo) return post("/api/documents/" + encodeURIComponent(id) + "/acknowledge", {});
  const d = demoDoc(id);
  if (d.receipt) return d.receipt;
  const owner = active.id,
    key = owner + "/" + id;
  const receipt = {
    actor: active.actor,
    at: new Date().toISOString()
  };
  await transaction("receipts", "readwrite", s => {
    const req = s.get(key);
    req.onsuccess = () => {
      if (!req.result) s.add({
        owner,
        doc: id,
        receipt
      }, key);
    };
  });
  return (await transaction("receipts", "readonly", s => s.get(key))).receipt;
}
export async function sendResponse(id, data) {
  if (!isDemo) return post("/api/documents/" + encodeURIComponent(id) + "/responses", data);
  const doc = demoDoc(id);
  if (!doc.points.some(p => p.id === data.pointId)) throw Error("Пункт предписания не найден.");
  const key = [active.id, id, data.requestId].join("/");
  const record = {
    ...data,
    id: key,
    actor: active.actor,
    owner: active.id,
    doc: id,
    at: new Date().toISOString()
  };
  await transaction("responses", "readwrite", s => {
    const req = s.get(key);
    req.onsuccess = () => {
      if (!req.result) s.add(record);
    };
  });
}
export async function responseFile(id) {
  if (!isDemo) return "/api/attachments/" + encodeURIComponent(id);
  const r = await transaction("responses", "readonly", s => s.get(id));
  if (!r || r.owner !== active.id) throw Error("Вложение не найдено.");
  const raw = Uint8Array.from(atob(r.fileBase64), c => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([raw], {
    type: "application/octet-stream"
  }));
}
