import * as client from "./client.js";
import {
  directions,
  sectors,
  professions,
  eligibleDirections,
  documentTitle,
  caseStatuses,
  dateText,
  stampText,
  localDay,
  periodText,
  idLabel,
  pendingCount
} from "./catalog.js";
import {
  icon as i
} from "./icons.js";

const $ = (selector) => document.querySelector(selector);
const esc = (v = "") => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[c]);
const selected = (v, actual) => v === actual ? " selected" : "";
const attrs = (k, v) => ' data-' + k + '="' + esc(v) + '"';
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("");
const byDate = (a, b) => b.start.localeCompare(a.start) || b.number.localeCompare(a.number);
const baseFilters = () => ({
  q: "",
  source: "all",
  year: "all",
  status: "all"
});
let data, filters = baseFilters(),
  mobileOpen = false,
  viewer = null,
  pdfUrl = null,
  modalToken = 0,
  notifyTimer, boardVersion = 0;
let replyRequestId = null;
const modal = $("#modal"),
  shell = $("#shell");

function route() {
  const [section = "checks", id] = location.hash.replace(/^#\/?/, "").split("/");
  return {
    section: section || "checks",
    id
  };
}

function findCase(id) {
  return data.cases.find(c => c.id === id);
}

function findDocument(id) {
  for (const c of data.cases) {
    const d = c.documents.find(d => d.id === id);
    if (d) return {
      c,
      d
    };
  }
}

function counts() {
  return {
    total: data.cases.length,
    active: data.cases.filter(c => c.status !== "closed").length,
    unread: data.cases.reduce((n, c) => n + pendingCount(c), 0)
  };
}

function tag(source) {
  return '<span class="tag direction ' + source + '"><span></span>' + directions[source].short + '</span>';
}

function status(value) {
  return '<span class="tag status ' + value + '"><span></span>' + caseStatuses[value] + '</span>';
}

function notice(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("show");
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => $("#toast").classList.remove("show"), 3900);
}

function link(path, icon, label, active, count) {
  return '<a href="#/' + path + '" class="navlink' + (active ? " current" : "") + '"' + (active ?
    ' aria-current="page"' : '') + '>' + i(icon, 19) + '<span>' + label + '</span>' + (count ? '<b>' +
    count + '</b>' : '') + '</a>';
}

function pageTitle() {
  const {
    section,
    id
  } = route();
  if (section === "inbox") return "На ознакомление";
  if (section === "profile") return "Карточка объекта";
  if (section === "checks" && id) return findCase(id)?.number || "Проверка";
  return "Мои проверки";
}

function allDirections() {
  return [...new Set([...eligibleDirections(data.profile), ...data.cases.map(c => c.source)])];
}

function render() {
  const {
    section,
    id
  } = route(), p = data.profile, n = counts();
  const sub = pageTitle();
  document.title = sub + " · Кабинет ОГА · SAQ";
  shell.innerHTML = `
    <div class="workspace${mobileOpen?" mobile-open":""}">
      <button class="scrim" aria-label="Закрыть меню" data-action="menu"></button>
      <aside class="sidebar">
        <a class="brand" href="#/checks" aria-label="SAQ — мои проверки"><img src="/saq.svg" alt=""><span><strong>SAQ</strong><small>Smart Audit Qazaqstan</small></span></a>
        <div class="module-name"><span class="modmark">ОГА</span><b>Кабинет ОГА</b></div>
        <nav aria-label="Кабинет объекта">
          ${link("checks","folders","Мои проверки",section==="checks")}
          ${link("inbox","inbox","На ознакомление",section==="inbox",n.unread)}
          ${link("profile","building","Карточка объекта",section==="profile")}
        </nav>
        <div class="side-bottom"><a class="portal-link" href="https://smartaudit.kz/">${i("grid",17)} Главное меню SAQ ${i("external",14)}</a></div>
      </aside>
      <div class="stage">
        <header class="topbar">
          <button type="button" class="iconbtn burger" aria-label="Меню" data-action="menu">${i("menu")}</button>
          <div class="crumb"><span>Кабинет ОГА</span>${i("next",12)}${id?'<a href="#/checks">Мои проверки</a>'+i("next",12):""}<strong>${esc(sub)}</strong></div>
          <div class="account-bar">${client.isDemo?'<button type="button" class="demo-switch" data-action="profiles" title="Сменить демообъект">Демообъект '+i("down",13)+'</button>':""}
            <div class="account"><b class="avatar">${esc(initials(p.actor))}</b><span><strong>${esc(p.actor)}</strong><small>Представитель объекта</small></span></div>
          </div>
        </header>
        <main id="main-content" tabindex="-1">
          ${section==="profile"?profilePage():section==="inbox"?inboxPage():section==="checks"&&id?detailPage(findCase(id)):section==="checks"?registryPage():empty("Страница не найдена","Вернитесь в реестр проверок.",true)}
        </main>
      </div>
    </div>`;
}

function banner() {
  const p = data.profile;
  return `<section class="identity">
    <div class="identity-mark">${i(p.idType==="iin"?"person":"city",30)}</div>
    <div class="identity-body"><div class="sector">${esc(sectors[p.sector])}${p.category?" · "+esc(p.category==="ОЦ"?"Оценщик":p.category):""}</div>
      <h2>${esc(p.name)}</h2><div class="identity-meta"><span>${idLabel(p)} ${esc(p.id)}</span>${p.region?'<span>'+i("pin",13)+esc(p.region)+'</span>':""}</div>
    </div>
    <a class="identity-link" href="#/profile" aria-label="Открыть карточку объекта" title="Карточка объекта">${i("arrow",19)}</a>
  </section>`;
}

function stat(icon, label, value, tone, action, active = false) {
  return `<button class="stat ${tone}${active?" picked":""}" data-action="${action}"><span class="stat-ico">${i(icon,20)}</span><span><small>${label}</small><b>${value}</b></span><span class="stat-arrow">${i("next",14)}</span></button>`;
}

function empty(title, detail, back = false) {
  return `<div class="empty"><span>${i("folders",30)}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p>${back?'<a class="button outline" href="#/checks">Мои проверки</a>':""}</div>`;
}

function registryPage() {
  const n = counts();
  return `<div class="page-heading"><div><h1>Мои проверки</h1><p>Текущие и завершённые мероприятия по вашему объекту</p></div></div>
    ${banner()}
    <section class="stats" aria-label="Сводка по объекту">
      ${stat("folders","Всего проверок",n.total,"blue","all")}
      ${stat("active","В работе и на исполнении",n.active,"teal","active",filters.status==="open")}
      ${stat("inbox","Документов на ознакомление",n.unread,"amber","inbox")}
    </section>
    <section class="panel registry">
      <div class="panel-heading"><div class="inline"><h2>Реестр проверок</h2><span class="counter" id="filtered-count"></span></div></div>
      <div class="filters"><label class="search">${i("search",17)}<input id="search" type="search" autocomplete="off" aria-label="Поиск по названию или номеру" placeholder="Поиск по названию или номеру" value="${esc(filters.q)}"></label>
        <label class="select-wrap">${i("calendar",15)}<select id="year" aria-label="Год проверки"><option value="all">Все годы</option>${[...new Set(data.cases.map(c=>c.start.slice(0,4)))].sort().reverse().map(y=>'<option'+selected(y,filters.year)+'>'+y+'</option>').join("")}</select>${i("down",13)}</label>
        <label class="select-wrap">${i("sliders",15)}<select id="status" aria-label="Статус проверки"><option value="all">Все статусы</option><option value="open"${selected("open",filters.status)}>В работе и на исполнении</option>${Object.entries(caseStatuses).map(([key,v])=>'<option value="'+key+'"'+selected(key,filters.status)+'>'+v+'</option>').join("")}</select>${i("down",13)}</label>
      </div>
      <div class="direction-tabs" aria-label="Направление проверки">
        ${["all",...allDirections()].map(k=>'<button type="button" data-source="'+k+'" aria-pressed="'+(filters.source===k)+'" class="'+(filters.source===k?"on":"")+'">'+(k==="all"?"Все направления":k==="prof"?"Профконтроль":directions[k].short)+'</button>').join("")}
      </div>
      <div id="registry-list"></div>
    </section>`;
}

function rows() {
  const target = $("#registry-list");
  if (!target) return;
  const q = filters.q.toLocaleLowerCase("ru").trim();
  const filtered = data.cases.filter(c => (filters.source === "all" || filters.source === c.source) && (
      filters.year === "all" || c.start.startsWith(filters.year)) &&
    (filters.status === "all" || (filters.status === "open" ? c.status !== "closed" : c.status === filters
      .status)) &&
    (!q || (c.number + " " + c.title).toLocaleLowerCase("ru").includes(q))).sort(byDate);
  $("#filtered-count").textContent = filtered.length;
  if (!filtered.length) {
    target.innerHTML = empty(data.cases.length ? "Проверки не найдены" : "Проверок пока нет", data.cases
        .length ? "Измените параметры поиска или сбросьте фильтры." :
        "После направления первого документа здесь появится мероприятие.") +
      (data.cases.length ?
        '<div class="empty-reset"><button class="button outline" data-action="reset">Сбросить фильтры</button></div>' :
        "");
    return;
  }
  target.innerHTML =
    '<div class="table-wrap"><table class="case-table"><thead><tr><th>Мероприятие</th><th>Направление</th><th>Статус</th><th>Документы</th><th><span class="sr">Открыть</span></th></tr></thead><tbody>' +
    filtered.map((c, idx) => {
      const pending = pendingCount(c),
        year = c.start.slice(0, 4);
      const group = idx === 0 || filtered[idx - 1].start.slice(0, 4) !== year ?
        '<tr class="year-row"><th colspan="5">' + esc(year) + '</th></tr>' : "";
      return group + `<tr data-case="${esc(c.id)}" class="case-row"><td><a class="case-name" href="#/checks/${esc(c.id)}">${esc(c.title)}</a><small class="case-sub"><span>${esc(c.number)}</span><span>${esc(periodText(c))}</span></small></td>
        <td data-label="Направление">${tag(c.source)}</td><td data-label="Статус">${status(c.status)}</td>
        <td data-label="Документы"><span class="doc-count">${i("file",14)} ${c.documents.length}</span>
        ${pending?'<small class="pending-text">'+pending+' на ознакомление</small>':'<small class="read-text">Все прочитаны</small>'}</td>
        <td class="row-go">${i("next",15)}</td></tr>`;
    }).join("") + '</tbody></table></div>';
}

function draw() {
  render();
  rows();
}

function docLabel(c, d) {
  return documentTitle(c.source, d.kind) || d.kind;
}

function docLine(c, d, showCase = false) {
  const title = docLabel(c, d);
  const version = c.documents.some(x => x.sourceId === d.sourceId && x.id !== d.id) || d.version > 1;
  return `<article class="doc-line"><span class="pdf-mark" aria-hidden="true">PDF</span><div class="doc-text">
    <button class="text-button doc-name" data-doc="${esc(d.id)}">${esc(title)}</button>
    <div class="minor"><span>№ ${esc(d.number)}</span><span>${dateText(d.sentAt)}</span>${version?'<span>Версия '+d.version+'</span>':""}</div>
    ${showCase?'<a class="case-ref" href="#/checks/'+esc(c.id)+'">'+esc(c.number)+" · "+esc(c.title)+'</a>':""}
    </div><div class="doc-state ${d.receipt?"done":"waiting"}">${i(d.receipt?"checkCircle":"clock",15)}<span>${d.receipt?"Ознакомлен":"На ознакомление"}</span></div>
    <button class="button outline" data-doc="${esc(d.id)}">${d.receipt?"Открыть PDF":"Ознакомиться"}</button></article>`;
}

function inboxPage() {
  const pending = data.cases.flatMap(c => c.documents.filter(d => !d.receipt).map(d => ({
    c,
    d
  }))).sort((a, b) => b.d.sentAt.localeCompare(a.d.sentAt));
  return `<div class="page-heading"><div><h1>На ознакомление</h1><p>Направленные документы, по которым ожидается ваша отметка</p></div></div>
    <section class="panel"><div class="panel-heading"><div class="inline"><h2>Документы</h2><span class="counter">${pending.length}</span></div></div>
    ${pending.length?pending.map(({c,d})=>docLine(c,d,true)).join(""):empty("Все документы прочитаны","Полученные документы доступны в карточках проверок.",true)}</section>`;
}

function kv(label, value) {
  return '<div><dt>' + label + '</dt><dd>' + esc(value) + '</dd></div>';
}

function detailPage(c) {
  if (!c) return empty("Проверка не найдена", "Откройте мероприятие из реестра вашего объекта.", true);
  const p = data.profile;
  const docs = [...c.documents].sort((a, b) => b.sentAt.localeCompare(a.sentAt) || b.version - a.version);
  const unread = pendingCount(c);
  return `<a class="back" href="#/checks">${i("back",14)} К реестру проверок</a>
    <div class="detail-top">${tag(c.source)}<b>${esc(c.number)}</b>${status(c.status)}</div>
    <div class="page-heading detail-heading"><div><h1>${esc(c.title)}</h1><p>${esc(p.name)}</p></div></div>
    <dl class="facts">${kv("Период проведения",periodText(c))}${kv("Проверяющий орган",c.issuer)}${kv("Направление",directions[c.source].name)}${c.category?kv("Категория субъекта",professions[c.category]||c.category):""}</dl>
    <section class="panel"><div class="panel-heading"><div class="inline"><h2>Документы проверки</h2><span class="counter">${docs.length}</span></div>${unread?'<span class="pending-text">'+unread+' на ознакомление</span>':""}</div>
    ${docs.length?docs.map(d=>docLine(c,d)).join(""):empty("Документов пока нет","Направленные печатные формы появятся в этой проверке.")}</section>`;
}

function profilePage() {
  const p = data.profile;
  return `<div class="page-heading"><div><h1>Карточка объекта</h1></div></div>${banner()}
    <section class="panel"><div class="panel-heading"><h2>Сведения об объекте</h2></div><dl class="profile-fields">
    ${kv("Наименование",p.name)}${kv(idLabel(p),p.id)}${kv("Сектор",sectors[p.sector])}${p.category?kv("Категория профконтроля",professions[p.category]):""}
    ${p.region?kv("Регион",p.region):""}${kv("Представитель",p.actor)}${kv("Доступные направления",eligibleDirections(p).map(s=>directions[s].name).join(", ") || "Нет назначенных направлений")}</dl></section>`;
}

function header(title, sub) {
  return `<div class="dialog-head"><div>${sub?'<p>'+esc(sub)+'</p>':""}<h2 id="dialog-title">${esc(title)}</h2></div><button class="iconbtn" data-action="close" title="Закрыть" aria-label="Закрыть">${i("close")}</button></div>`;
}

function openModal(cls, html) {
  if (!modal.open) modal.showModal();
  modal.className = cls;
  modal.setAttribute("aria-labelledby", "dialog-title");
  modal.innerHTML = html;
  modal.querySelector("button")?.focus();
}

function clearModal() {
  modalToken++;
  viewer = null;
  replyRequestId = null;
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = null;
}

function close() {
  if (modal.open) modal.close();
}
modal.addEventListener("close", clearModal);
modal.addEventListener("click", e => {
  if (e.target === modal && e.clientX >= 0) {
    const r = modal.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  }
});

function showProfiles() {
  const opts = client.demoProfiles.map(p =>
    `<button class="choice${p.id===data.profile.id?" chosen":""}" data-profile="${esc(p.id)}"><span class="square">${i(p.idType==="iin"?"person":"building",18)}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.category?professions[p.category]:sectors[p.sector])}</small></span>${p.id===data.profile.id?i("check",16):""}</button>`
    ).join("");
  openModal("profile-modal", header("Выберите демообъект", "Демонстрационный кабинет") +
    '<div class="choices">' + opts + '</div>');
}

function showError(msg) {
  let node = modal.querySelector(".form-error");
  if (node) {
    node.textContent = msg;
    node.hidden = false;
  } else notice(msg);
}
async function showDoc(id) {
  const found = findDocument(id);
  if (!found) return;
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = null;
  viewer = found;
  const seq = ++modalToken,
    {
      c,
      d
    } = found,
    title = docLabel(c, d);
  openModal("document-modal", header(title, c.number + " · № " + d.number + " · Версия " + d.version) + `<div class="viewer-strip"><span>${i("calendar",15)} Направлен ${esc(stampText(d.sentAt))}</span><div id="print-links"></div></div>
    <div id="pdf-pane" class="pdf-pane" aria-live="polite"><div class="loading-print">Загрузка печатной формы…</div></div>
    <div class="form-error" role="alert" hidden></div><div class="doc-footer" id="doc-footer"></div>`);
  try {
    const url = await client.pdf(id);
    if (!modal.open || modalToken !== seq) {
      URL.revokeObjectURL(url);
      return;
    }
    pdfUrl = url;
    $("#print-links").innerHTML = '<a href="' + url + '" target="_blank" rel="noopener">' + i("external",
        14) + '<span>В новой вкладке</span></a><a href="' + url + '" download="' + esc(c.number + "_" + d
        .number.replaceAll("/", "-") + "_v" + d.version) + '.pdf">' + i("download", 15) +
      '<span>Скачать PDF</span></a>';
    $("#pdf-pane").innerHTML = navigator.pdfViewerEnabled === false ? '<div class="pdf-fallback">' + i(
        "file", 34) + '<p>Печатная форма готова.</p><a class="button primary" href="' + url +
      '" target="_blank" rel="noopener">Открыть PDF</a></div>' : '<iframe title="Печатная форма · ' + esc(
        title) + '" src="' + url + '#view=FitH"></iframe>';
    docFooter(c, d);
  } catch (error) {
    if (modalToken !== seq || !modal.open) return;
    $("#pdf-pane").innerHTML = '<div class="pdf-fallback"><p>' + esc(error.message) +
      '</p><button class="button outline" data-doc="' + esc(id) + '">Повторить загрузку</button></div>';
  }
}

function docFooter(c, d) {
  const hasPoints = c.source === "prof" && d.kind === "prescription" && d.points.length;
  const receipt = d.receipt ? '<span class="receipt done">' + i("checkCircle", 18) +
    '<span><b>Ознакомлен</b><small>' + esc(d.receipt.actor) + " · " + esc(stampText(d.receipt.at)) +
    '</small></span></span>' : '<span class="receipt waiting">' + i("clock", 17) +
    'Ожидает ознакомления</span>';
  $("#doc-footer").innerHTML = receipt + '<div class="actions">' + (hasPoints ?
    '<button class="button outline" data-action="responses">' + i("reply", 16) + 'Ответ по предписанию' + (d
      .responses.length ? " (" + d.responses.length + ")" : "") + '</button>' : "") + (d.receipt ? "" :
    '<button class="button primary" data-action="ack">' + i("check", 16) +
    'Подтвердить ознакомление</button>') + '</div>';
}

function responsePanel() {
  const {
    d,
    c
  } = viewer;
  replyRequestId = crypto.randomUUID();
  const history = d.responses.map(r =>
    `<div class="response-row"><b>Пункт ${esc(r.pointId)} · ${esc(stampText(r.at))}</b><p>${esc(r.measures)}</p><small>${esc(r.actor)} · Исполнено ${esc(dateText(r.completed))}</small><button class="text-button" data-attachment="${esc(r.id)}" data-filename="${esc(r.filename)}">${i("download",14)} ${esc(r.filename)}</button></div>`
    ).join("");
  openModal("response-modal", header("Ответ по предписанию", c.number + " · № " + d.number) + `<div class="response-body"><form id="response-form">
    <label>Пункт предписания<select name="point">${d.points.map(p=>'<option value="'+esc(p.id)+'">Пункт '+esc(p.id)+'</option>').join("")}</select></label>
    <div class="point-context" id="point-info"></div>
    <label>Принятые меры<textarea name="measures" maxlength="8000" required rows="3"></textarea></label>
    <label>Дата исполнения<input type="date" name="completed" max="${localDay()}" required></label>
    <label>Подтверждающий документ <small>до 8 МБ</small><input type="file" name="file" required></label>
    <div class="form-error" role="alert" hidden></div><div class="actions"><button type="button" class="button outline" data-doc="${esc(d.id)}">К печатной форме</button><button class="button primary" type="submit">Направить ответ</button></div></form>
    ${history?'<div class="reply-history"><h3>Направленные ответы</h3>'+history+'</div>':""}</div>`);
  updatePoint();
}

function updatePoint() {
  const id = $("#response-form select").value;
  const p = viewer.d.points.find(p => p.id === id);
  $("#point-info").innerHTML = esc(p.text) + '<small>Срок исполнения · ' + dateText(p.deadline) + '</small>';
}
async function refresh() {
  const v = ++boardVersion;
  const result = await client.loadCabinet();
  if (v !== boardVersion) return false;
  data = result;
  draw();
  return true;
}
async function ack(button) {
  if (!viewer || !pdfUrl) return;
  const id = viewer.d.id,
    token = modalToken;
  button.disabled = true;
  try {
    const receipt = await client.acknowledge(id);
    const old = findDocument(id);
    if (old) {
      old.d.receipt = receipt;
      draw();
    }
    if (viewer && modal.open && token === modalToken) {
      viewer.d.receipt = receipt;
      docFooter(viewer.c, viewer.d);
    }
    notice("Ознакомление зарегистрировано");
  } catch (error) {
    if (token === modalToken) showError(error.message);
    button.disabled = false;
  }
}
async function submitReply(form) {
  const file = form.elements.file.files[0];
  if (!file || !file.size || file.size > 8 * 1024 * 1024) return showError(
    "Выберите непустой файл размером до 8 МБ.");
  const measures = form.elements.measures.value.trim();
  if (!measures) return showError("Укажите принятые меры.");
  const id = viewer.d.id,
    token = modalToken;
  const sent = {
    requestId: replyRequestId,
    pointId: form.elements.point.value,
    measures,
    completed: form.elements.completed.value,
    filename: file.name
  };
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const encoded = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(Error("Не удалось прочитать файл."));
      reader.readAsDataURL(file);
    });
    await client.sendResponse(id, {
      ...sent,
      fileBase64: encoded
    });
    await refresh();
    if (modal.open && token === modalToken) {
      viewer = findDocument(id);
      responsePanel();
    }
    notice("Ответ по пункту зарегистрирован");
  } catch (error) {
    if (token === modalToken) showError(error.message);
    btn.disabled = false;
  }
}
document.addEventListener("click", async e => {
  const el = e.target.closest("button,a,[data-case]");
  if (!el || !data) return;
  if (el.matches("a.skip")) {
    e.preventDefault();
    $("#main-content")?.focus();
    return;
  }
  const action = el.dataset.action;
  try {
    if (action === "close") return close();
    if (action === "menu") {
      mobileOpen = !mobileOpen;
      return draw();
    }
    if (action === "profiles" && client.isDemo) return showProfiles();
    if (el.dataset.profile && client.isDemo) {
      close();
      client.switchProfile(el.dataset.profile);
      filters = baseFilters();
      location.hash = "/checks";
      await refresh();
      return;
    }
    if (el.dataset.doc) return showDoc(el.dataset.doc);
    if (el.dataset.source) {
      filters.source = el.dataset.source;
      draw();
      shell.querySelector('[data-source="' + filters.source + '"]')?.focus();
      return;
    }
    if (el.dataset.attachment) {
      const url = await client.responseFile(el.dataset.attachment),
        a = document.createElement("a");
      a.href = url;
      a.download = el.dataset.filename;
      a.click();
      if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 30000);
      return;
    }
    if (action === "reset" || action === "all") {
      filters = baseFilters();
      return draw();
    }
    if (action === "active") {
      filters = {
        ...baseFilters(),
        status: "open"
      };
      return draw();
    }
    if (action === "inbox") {
      location.hash = "/inbox";
      return;
    }
    if (action === "ack") return ack(el);
    if (action === "responses") return responsePanel();
    if (el.dataset.case && !window.getSelection()?.toString()) location.hash = "/checks/" + el.dataset
      .case;
  } catch (error) {
    if (modal.open) showError(error.message);
    else notice(error.message);
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "search") {
    filters.q = e.target.value;
    rows();
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "year" || e.target.id === "status") {
    filters[e.target.id] = e.target.value;
    draw();
    $("#" + e.target.id)?.focus();
  }
  if (e.target.matches("#response-form select")) updatePoint();
});
document.addEventListener("submit", e => {
  if (e.target.id === "response-form") {
    e.preventDefault();
    submitReply(e.target);
  }
});
window.addEventListener("hashchange", () => {
  mobileOpen = false;
  close();
  if (data) {
    draw();
    window.scrollTo(0, 0);
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && data && !modal.open) refresh().catch(e => notice(e.message));
});
try {
  data = await client.initialize();
  draw();
} catch (error) {
  shell.innerHTML = '<div class="load-error">' + i("info", 28) + '<h1>Кабинет недоступен</h1><p>' + esc(error
      .message) +
    '</p><div class="actions"><a class="button outline" href="https://smartaudit.kz/">На портал SAQ</a><button class="button primary" id="reload">Повторить</button></div></div>';
  $("#reload").addEventListener("click", () => location.reload());
}
