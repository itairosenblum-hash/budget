# תקציב אחזקה צהר"מ

אפליקציית PWA לניהול סעיפי התקציב של אחזקת צהר"מ, באותו מבנה של TripCost:
האתר (`index.html`) נפרס ל-GitHub Pages, וסנכרון וכניסה עוברים דרך Firebase.

## מה יש כרגע (שלב 1)

- **סעיפי תקציב** — מספר סעיף, שם, שנת תקציב, תקציב מאושר והערות. לכל סעיף פס ניצול ויתרה, ובראש המסך סיכום כולל.
- **כרטיסיות חברות** — שם, ח.פ, איש קשר, אימייל, טלפון ונייד לוואטסאפ, עם כפתורי וואטסאפ / מייל / חיוג.
- **הזמנות עבודה (1007)** — חברה, תאריך, מס' הזמנה, סודר, צ', סוג כלי, שעות מנוע, יחידה, התיקונים ופירוט התיקון,
  ובנוסף סעיף תקציב וסכום (נספרים בניצול הסעיף, לא מודפסים בטופס). **הפקת 1007** ממלאת את `1007-template.docx`
  בשדות שמסומנים בו ב-[ ] ומורידה קובץ בשם `1007.docx`. **שליחה** — בתפריט השיתוף של הטלפון (וואטסאפ / מייל עם הקובץ מצורף),
  או ישירות לנייד / למייל שבכרטיס החברה.
- **חשבוניות** — סריקה (מצלמים או בוחרים תמונה / PDF) והפרטים מתמלאים לבד: חברה (לפי ח.פ או שם), מס' חשבונית, תאריך,
  סכומים, והזמנת העבודה שהחשבונית שייכת לה (לפי מס' הזמנה או צ'). חשבונית שמקושרת להזמנה מחליפה בניצול הסעיף את הסכום שהוזן בהזמנה.
  הקובץ נשמר כרגע במכשיר שבו נסרק.
- **סנכרון** — כניסה עם Google ושמירה במסמך `users/{uid}/data/state`. הנתונים נשמרים גם במכשיר, ומתמזגים כשמתחברים.
- **גיבוי ושחזור** לקובץ JSON מתפריט ההגדרות.

## שלבים הבאים

1. הטבעת החותמת (`stamp.png`) על החשבונית ושליחה בוואטסאפ או במייל.
2. שמירת קבצי החשבוניות בענן, כדי שיהיו זמינים מכל מכשיר.

## עדכון טופס 1007

מחליפים את `1007-template.docx` בגרסה חדשה. השדות שהאתר ממלא הם בדיוק:
`[שם החברה]` `[תאריך הנפקת מסמך]` `[מס' הזמנה]` `[מס' סודר]` `[מס' צ']` `[סוג הכלי]` `[שעות מנוע]` `[יחידה]` `[שדה תיקונים]` `[פירוט התיקון]`.
כל שדה צריך להיות מוקלד ברצף אחד ב-Word (בלי לשנות עיצוב באמצע), אחרת Word מפצל אותו והאתר לא ימצא אותו.

## הגדרה חד-פעמית

1. **ריפו:** ליצור ב-GitHub הריפו `budget` ולהעלות את כל הקבצים.
   Settings ← Pages ← Source: `main` / root.
2. **Firebase:** ב-[Firebase Console](https://console.firebase.google.com/) ← Add project.
   - Build ← **Authentication** ← Get started ← Sign-in method ← **Google** ← Enable.
   - Authentication ← Settings ← **Authorized domains** ← להוסיף `itairosenblum-hash.github.io`.
   - Build ← **Firestore Database** ← Create database (אזור `europe-west1`) ← Rules ← להדביק את `firestore.rules` ← Publish.
   - Project settings ← Your apps ← **Web** (`</>`) ← Register ← להעתיק את ה-`firebaseConfig`.
3. **חיבור האתר:** להדביק את ה-config ב-`DEFAULT_FIREBASE_CONFIG` בתוך `index.html`
   — כבר מוגדר לפרויקט `budget-73660`.

## קריאת חשבוניות (Gemini) — הגדרה חד-פעמית

הקריאה עוברת דרך הפונקציה `scanInvoice` ב-`functions/`, כך שהמפתח לא נחשף בדפדפן.
הפונקציות נפרסות אוטומטית מ-GitHub Actions בכל שינוי ב-`functions/` (כמו ב-TripCost).

1. **מפתח Gemini:** [Google AI Studio ← API keys](https://aistudio.google.com/apikey). אפשר להעתיק את המפתח הקיים של TripCost, או Create API key.
2. **Blaze:** [Firebase Console ← Usage and billing](https://console.firebase.google.com/project/budget-73660/usage/details) ← Modify plan ← Blaze. נדרש ל-Cloud Functions; בשימוש כזה זה בפועל בחינם.
3. **חשבון שירות לפריסה:** [Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=budget-73660) ← Create service account בשם `github-deploy`, עם התפקידים
   **Editor**, **Cloud Functions Admin**, **Cloud Run Admin**, **Secret Manager Admin**, **Service Account User**. אחר כך: Keys ← Add key ← JSON.
4. **Secrets בריפו:** Settings ← Secrets and variables ← Actions ← New repository secret:

   | שם | ערך |
   | --- | --- |
   | `GEMINI_API_KEY` | המפתח משלב 1 |
   | `FIREBASE_SERVICE_ACCOUNT` | כל התוכן של קובץ ה-JSON משלב 3 |

5. **פריסה:** Actions ← **Deploy Firebase functions** ← Run workflow.

## פריסת האתר

בכל שינוי בקבצי האתר מעלים את `CACHE_NAME` ב-`sw.js` ומעדכנים את `versionStamp` בתחתית `index.html`.
חוקי Firestore מתעדכנים ידנית ב-Firebase Console.
