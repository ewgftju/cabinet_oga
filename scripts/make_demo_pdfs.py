"""Rebuild immutable demo print files. Requires Python, ReportLab and Liberation Serif."""
import base64
import io
import json
import os
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
fonts = Path(os.environ.get("OGA_PDF_FONTS", "/usr/share/fonts/truetype/liberation2"))
if not fonts.is_dir():
    fonts = Path("/usr/share/fonts/truetype/liberation")
for name, file in [("Doc", "LiberationSerif-Regular.ttf"), ("DocBold", "LiberationSerif-Bold.ttf")]:
    pdfmetrics.registerFont(TTFont(name, fonts / file))
styles = {
    "body": ParagraphStyle("Body", fontName="Doc", fontSize=12, leading=16, spaceAfter=7, alignment=TA_JUSTIFY),
    "issuer": ParagraphStyle("Issuer", fontName="DocBold", fontSize=12, leading=15, alignment=TA_CENTER),
    "title": ParagraphStyle("Title", fontName="DocBold", fontSize=16, leading=20, alignment=TA_CENTER, spaceAfter=10),
    "label": ParagraphStyle("Label", fontName="DocBold", fontSize=11, leading=14),
    "value": ParagraphStyle("Value", fontName="Doc", fontSize=11, leading=14),
}
def para(s, style="body"):
    return Paragraph(escape(s), styles[style])

def dt(s):
    return datetime.fromisoformat(s[:10]).strftime("%d.%m.%Y")

def grid(rows, widths=(49*mm, 118*mm)):
    table = Table([[para(k, "label"), para(v, "value")] for k,v in rows], colWidths=widths, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"), ("LINEBELOW",(0,0),(-1,-1),0.35,colors.HexColor("#c4c9cc")), ("TOPPADDING",(0,0),(-1,-1),6), ("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    return table

article = json.loads((ROOT / "demo/article-155.ru.json").read_text())
source = subprocess.check_output(["node", "--input-type=module", "-e",
    "import {cases,profiles} from './demo/scenarios.mjs'; import {auditKinds,profKinds} from './web/catalog.js'; console.log(JSON.stringify({cases,profiles,auditKinds,profKinds}));"], cwd=ROOT)
data = json.loads(source)
profiles = {p["id"]:p for p in data["profiles"]}

def content(c, d, obj):
    start, end = dt(c["start"]), dt(c["end"])
    period = f"{start} – {end}"
    kind, title = d["kind"], c["title"]
    actions = {
        "instruction": [f"Поручается провести аудиторское мероприятие «{title}» в отношении объекта {obj['name']}.",
                        f"Срок проведения аудиторского мероприятия: {period}.", "Руководителю группы обеспечить изучение первичных документов, сверку данных бухгалтерского учёта и оформление результатов."],
        "additional": [f"В дополнение к поручению по мероприятию «{title}» уточняется перечень вопросов, подлежащих проверке.",
                       "Включить проверку исполнения договоров и сопоставление актов приёмки с регистрами бухгалтерского учёта.", "Остальные условия поручения сохраняются."],
        "request": ["Для проведения аудиторского мероприятия просим представить следующие сведения.",
                    "1. Реестр заключённых договоров и дополнительных соглашений за проверяемый период.",
                    "2. Копии актов приёмки и соответствующие выписки из регистров учёта."],
        "report": [f"В период {period} проведено мероприятие «{title}».",
                   "Группа аудита изучила первичные документы, договоры и регистры учёта. По выборке установлены расхождения в датах регистрации подтверждающих документов.",
                   "Объекту направлены результаты проверки для ознакомления."],
        "conclusion": [f"По итогам аудиторского мероприятия «{title}» рассмотрены выводы аудиторского отчёта.",
                       "Объекту рекомендовано уточнить порядок внутренней сверки документов и закрепить ответственных за соблюдение сроков регистрации."],
        "prescription": [f"По результатам мероприятия «{title}» объекту предписывается устранить установленные нарушения.",
                         "Сведения об исполнении представить с приложением подтверждающих материалов."],
        "notice": [f"Уведомляем о проведении профилактического контроля с посещением субъекта {obj['name']}.",
                   f"Предмет контроля: {title}. Дата начала: {start}.", "Просим обеспечить доступ к документам и участие уполномоченного представителя."],
        "appointment-act": [f"Назначить профилактический контроль с посещением субъекта {obj['name']} в период {period}.",
                            f"Предмет контроля: {title}.", "Проверяющим провести контроль по направленному субъекту проверочному листу."],
        "additional-act": [f"К акту о назначении контроля по делу № {c['number']} определён дополнительный срок.",
                           "Основание: необходимость завершить сверку представленных материалов.", f"Дата окончания с учётом изменения: {end}."],
        "refusal-protocol": [f"При вручении акта о назначении по делу № {c['number']} представитель отказался принять бумажный экземпляр.",
                             "Обстоятельства отказа зафиксированы проверяющим. Экземпляр протокола направлен субъекту через кабинет."],
        "checklist": [f"Проверочный лист по мероприятию «{title}».", "Предъявляемые требования приведены ниже."],
        "result-act": [f"Контроль проведён в период {period}. Изучены представленные субъектом документы по утверждённому перечню требований.",
                       "Установлено расхождение в порядке ведения реестра документов. Результаты доведены до субъекта контроля."],
        "objection-result": [f"Рассмотрены доводы субъекта по акту о результатах по делу № {c['number']}.",
                             "Довод о дате представления реестра принят. Формулировка замечания уточнена с учётом подтверждающего документа."],
    }
    if kind == "article-155":
        return [para(article["title"], "label"), Spacer(1, 3*mm)] + [para(p["text"], "label" if p["bold"] else "body") for p in article["paragraphs"]]
    body = [para(t) for t in actions[kind]]
    if kind == "request" and d["version"] > 1:
        body.append(para("3. Дополнительно представить ведомость сверки по договорам, указанным в реестре."))
    if kind == "checklist":
        body.append(grid([("1", "Наличие утверждённых внутренних регламентов по предмету контроля."), ("2", "Ведение реестра и наличие документов, подтверждающих представленные сведения.")], (13*mm,154*mm)))
    if kind == "prescription":
        points = d["points"] or [{"id":"1","text":"Провести сверку и представить сведения о принятых мерах.","deadline":(datetime.fromisoformat(c["end"])+timedelta(days=30)).date().isoformat()}]
        body.append(grid([("Пункт "+p["id"], p["text"]+" Срок: "+dt(p["deadline"])+".") for p in points]))
    return body

def render(c,d):
    obj = profiles[c["owner"]]
    name = (data["profKinds"] if c["source"] == "prof" else data["auditKinds"])[d["kind"]]
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=22*mm, rightMargin=21*mm, topMargin=24*mm, bottomMargin=24*mm, title=name, author="SAQ — демонстрационный кабинет", invariant=1, pageCompression=0)
    story = [para(c["issuer"], "issuer"), Spacer(1,9*mm), para(name,"title"),
             para("№ "+d["number"]+" от "+dt(d["sentAt"]),"issuer"), Spacer(1,7*mm),
             grid([("Получатель",obj["name"]),("ИИН" if obj["idType"]=="iin" else "БИН",obj["id"]),
                   ("Мероприятие",c["number"]+" · "+c["title"])]), Spacer(1,8*mm)] + content(c,d,obj)
    def footer(canvas, doc):
        for font in ("Doc", "DocBold"):
            pdfmetrics.getFont(font).splitString("".join(chr(k) for k in range(32,127)) + "".join(chr(k) for k in range(0x400,0x500)) + "№–—«»·", canvas._doc)
        canvas.setStrokeColor(colors.HexColor("#a0aab3"))
        canvas.line(22*mm, 18*mm, 189*mm, 18*mm)
        canvas.setFont("Doc",9)
        canvas.drawString(22*mm,13*mm,"Демонстрационный экземпляр · SAQ · Редакция "+str(d["version"]))
        canvas.drawRightString(189*mm,13*mm,"Стр. "+str(doc.page))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return base64.b64encode(output.getvalue()).decode("ascii")

prints = {d["id"]:render(c,d) for c in data["cases"] for d in c["documents"]}
subprocess.run(["node", "--input-type=module", "-e",
    "import fs from 'node:fs'; import {brotliCompressSync as pack,constants as c} from 'node:zlib'; fs.writeFileSync('demo/prints.br',pack(fs.readFileSync(0),{params:{[c.BROTLI_PARAM_QUALITY]:6,[c.BROTLI_PARAM_LGWIN]:24}}));"],
    cwd=ROOT, input=json.dumps(prints, separators=(",",":")).encode(), check=True)
print("Prepared", len(prints), "demo PDF snapshots.")
