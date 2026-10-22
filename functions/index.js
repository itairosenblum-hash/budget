// תקציב אחזקה צהר"מ — Cloud Functions.
// scanInvoice: קורא חשבונית (תמונה או PDF) עם Gemini ומחזיר שדות לטופס החשבונית באתר.
// הפונקציה לא שומרת כלום. מפתח ה-Gemini מגיע מ-Secret בריפו (GEMINI_API_KEY) ומסונכרן בפריסה.
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions, logger } from "firebase-functions/v2";
import { defineSecret, defineString } from "firebase-functions/params";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: "europe-west1", maxInstances: 5 });

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const GEMINI_MODEL = defineString("GEMINI_MODEL", { default: "gemini-3.8-flash" });
// מודל גיבוי כשהמודל הראשי עמוס (שגיאת 503)
const GEMINI_FALLBACK_MODEL = defineString("GEMINI_FALLBACK_MODEL", { default: "gemini-flash-latest" });

const ADMIN_EMAIL = "itai.rosenblum@gmail.com";
const MAX_BYTES = 7 * 1024 * 1024;
const isAllowedType = (t) => /^image\//.test(t) || t === "application/pdf";

/* ---------- הרשאות ---------- */
// מורשים: המנהל, וכל מי שהמנהל שיתף איתו את הנתונים (members במסמך הנתונים שלו)
let adminUid = null;
async function requireAllowed(request) {
  const t = request.auth?.token;
  if (!t?.email || !t.email_verified) throw new HttpsError("unauthenticated", "נדרשת התחברות");
  const email = t.email.toLowerCase();
  if (email === ADMIN_EMAIL) return email;
  try {
    if (!adminUid) adminUid = (await getAuth().getUserByEmail(ADMIN_EMAIL)).uid;
    const snap = await db.doc(`users/${adminUid}/data/state`).get();
    const members = (snap.data()?.members || []).map((e) => String(e).toLowerCase());
    if (members.includes(email)) return email;
  } catch (e) {
    logger.warn("members lookup failed", e?.message || e);
  }
  throw new HttpsError("permission-denied", "אין הרשאה לסריקת חשבוניות");
}

/* ---------- קריאת חשבונית ---------- */

const SCAN_INSTRUCTIONS = `You extract structured data from a supplier invoice (חשבונית מס / חשבונית מס קבלה / חשבון עסקה / קבלה) issued to an Israeli military vehicle-maintenance unit (forklifts, cranes and other engineering equipment).
Most documents are in Hebrew. Write Hebrew output text; keep names exactly as printed.
Rules:
- supplierName: the issuing business (the seller), NOT the customer. The customer is usually צה"ל / משרד הביטחון / חיל הים / a military unit — never return that as the supplier. Drop legal suffixes like בע"מ unless part of the brand.
- supplierTaxId: the seller's ח.פ / ע.מ / עוסק מורשה / ת.ז number, digits only (usually 9 digits). null if absent.
- documentType: the document title as printed, e.g. "חשבונית מס", "חשבונית מס קבלה", "חשבון עסקה", "קבלה", "הצעת מחיר".
- invoiceNumber: the document's own number (מס' חשבונית / מספר מסמך), as printed.
- date: the document's issue date, YYYY-MM-DD. Israeli documents print day first (DD/MM/YY or DD.MM.YYYY).
- amountBeforeVat: total before VAT (סה"כ לפני מע"מ), a number, or null.
- vat: the VAT amount (מע"מ), a number, or null.
- total: the final total to pay including VAT (סה"כ לתשלום / סה"כ כולל מע"מ), a number. Ignore line subtotals.
- orderNumber: a customer purchase / work order number the invoice refers to (מס' הזמנה / הזמנת עבודה / הזמנת רכש / 1007 / PO), only if printed, else null.
- tzadi: the vehicle's number, digits only. On military paperwork it is "מס' צ'" / "צ."; on a civilian garage invoice for a military customer the same number is usually printed as "מספר רישוי" / "מס' רישוי" / "רישוי" — use that. Not the chassis / VIN (מס' מכשיר / שלדה), not a customer number. null if absent.
- vehicle: a short description of the vehicle as printed (for example "טרקטור Landini 7-175"), or null.
- engineHours: engine hours (שעות מנוע) as printed, digits only, or null. Ignore 0.
- allocationNumber: the Israel Tax Authority allocation number (מספר הקצאה / מס' הקצאה), digits only, or null.
- Ignore handwritten marks, "נאמן למקור" / "העתק" stamps, bank details, and any existing approval stamp or signature.
- description: one short Hebrew line describing the work or parts (for example "החלפת צמיג ותיקון נזילה במלגזה"), or null.
- Use null for anything not on the document. Never invent numbers.
- confidence: 0 to 1 per field, honest. Use below 0.7 when the text is blurry, cut off, handwritten or ambiguous.`;

const SCAN_FIELDS = ["supplierName", "supplierTaxId", "documentType", "invoiceNumber", "date",
  "amountBeforeVat", "vat", "total", "orderNumber", "tzadi", "vehicle", "engineHours", "allocationNumber", "description"];
const CONF_FIELDS = ["supplierName", "supplierTaxId", "invoiceNumber", "date", "total", "orderNumber"];

const SCAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    supplierName: { type: Type.STRING, nullable: true },
    supplierTaxId: { type: Type.STRING, nullable: true },
    documentType: { type: Type.STRING, nullable: true },
    invoiceNumber: { type: Type.STRING, nullable: true },
    date: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD" },
    amountBeforeVat: { type: Type.NUMBER, nullable: true },
    vat: { type: Type.NUMBER, nullable: true },
    total: { type: Type.NUMBER, nullable: true },
    orderNumber: { type: Type.STRING, nullable: true },
    tzadi: { type: Type.STRING, nullable: true },
    vehicle: { type: Type.STRING, nullable: true },
    engineHours: { type: Type.STRING, nullable: true },
    allocationNumber: { type: Type.STRING, nullable: true },
    description: { type: Type.STRING, nullable: true },
    confidence: {
      type: Type.OBJECT,
      properties: Object.fromEntries(CONF_FIELDS.map((f) => [f, { type: Type.NUMBER }]))
    }
  },
  required: [...SCAN_FIELDS, "confidence"],
  propertyOrdering: [...SCAN_FIELDS, "confidence"]
};

const validDate = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isFinite(Date.parse(s + "T00:00:00Z")) ? s : null;
};
const posNum = (v, max = 1e9) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v < max ? Math.round(v * 100) / 100 : null);
const cleanStr = (v, max = 120) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && s !== "null" ? s.slice(0, max) : null;
};
const digits = (v, max = 20) => {
  const s = String(v ?? "").replace(/\D/g, "");
  return s ? s.slice(0, max) : null;
};

export const scanInvoice = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  await requireAllowed(request);
  const { data, mimeType } = request.data || {};
  const type = String(mimeType || "");
  if (!isAllowedType(type)) throw new HttpsError("invalid-argument", `סוג קובץ לא נתמך: ${type}`);
  const buffer = Buffer.from(String(data || ""), "base64");
  if (buffer.length < 100) throw new HttpsError("invalid-argument", "הקובץ ריק");
  if (buffer.length > MAX_BYTES) throw new HttpsError("invalid-argument", "הקובץ גדול מדי (עד 7MB)");

  const context = `Today is ${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" })}. Use it to resolve two-digit years.`;
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value(), httpOptions: { timeout: 120000 } });
  const ask = (model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: type, data: buffer.toString("base64") } },
      { text: context }
    ] }],
    config: {
      systemInstruction: SCAN_INSTRUCTIONS,
      responseMimeType: "application/json",
      responseSchema: SCAN_SCHEMA,
      temperature: 0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  // עומס זמני (503/429) — מנסים שוב, ואז מודל הגיבוי. מכסה שנגמרה — אין טעם לנסות שוב
  const quota = (e) => /exceeded your current quota|billing/i.test(String(e?.message || ""));
  const busy = (e) => !quota(e) && /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(String(e?.status || "") + " " + String(e?.message || ""));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const primary = GEMINI_MODEL.value();
  const fallback = GEMINI_FALLBACK_MODEL.value();
  const plan = [[primary, 0], [primary, 2000], [primary, 5000], [fallback, 0], [fallback, 4000]];
  let r, usedModel, lastErr;
  for (let i = 0; i < plan.length; i++) {
    const [model, wait] = plan[i];
    if (wait) await sleep(wait);
    try {
      r = JSON.parse((await ask(model)).text);
      usedModel = model;
      break;
    } catch (e) {
      lastErr = e;
      logger.warn("gemini attempt failed", { model, message: String(e?.message || e).slice(0, 300) });
      if (quota(e)) break;
      if (!busy(e) && model === primary) i = plan.findIndex(([m]) => m === fallback) - 1;
    }
  }
  if (!r) {
    logger.error("gemini invoice scan failed", lastErr?.message || lastErr);
    const msg = String(lastErr?.message || lastErr?.cause?.message || "");
    if (quota(lastErr)) throw new HttpsError("resource-exhausted", "מכסת השימוש ב-AI נגמרה. בינתיים אפשר למלא ידנית.");
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) throw new HttpsError("failed-precondition", "מפתח ה-Gemini לא תקין. יש לבדוק את ה-Secret בריפו.");
    throw new HttpsError("unavailable", busy(lastErr)
      ? "שירות ה-AI עמוס כרגע. נסו שוב בעוד דקה או מלאו ידנית."
      : /timeout|aborted/i.test(msg) ? "הסריקה לקחה יותר מדי זמן. נסו שוב או מלאו ידנית." : "הסריקה נכשלה. אפשר למלא את הפרטים ידנית.");
  }

  let total = posNum(r.total);
  const amountBeforeVat = posNum(r.amountBeforeVat);
  const vat = posNum(r.vat);
  if (!total && amountBeforeVat && vat) total = Math.round((amountBeforeVat + vat) * 100) / 100;

  return {
    model: usedModel,
    supplierName: cleanStr(r.supplierName, 80),
    supplierTaxId: digits(r.supplierTaxId, 12),
    documentType: cleanStr(r.documentType, 40),
    invoiceNumber: cleanStr(r.invoiceNumber, 30),
    date: validDate(r.date),
    amountBeforeVat,
    vat,
    total,
    orderNumber: cleanStr(r.orderNumber, 30),
    tzadi: digits(r.tzadi, 12),
    vehicle: cleanStr(r.vehicle, 60),
    engineHours: digits(r.engineHours, 8) === "0" ? null : digits(r.engineHours, 8),
    allocationNumber: digits(r.allocationNumber, 20),
    description: cleanStr(r.description, 160),
    confidence: r.confidence && typeof r.confidence === "object" ? r.confidence : {}
  };
});
