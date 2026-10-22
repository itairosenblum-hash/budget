# תקציב אחזקה צהר"מ

אפליקציית PWA לניהול סעיפי התקציב של אחזקת צהר"מ, באותו מבנה של TripCost:
האתר (`index.html`) נפרס ל-GitHub Pages, וסנכרון וכניסה עוברים דרך Firebase.

## מה יש כרגע (שלב 1)

- **סעיפי תקציב** — מספר סעיף, שם, שנת תקציב, תקציב מאושר והערות. לכל סעיף פס ניצול ויתרה, ובראש המסך סיכום כולל.
- **כרטיסיות חברות** — שם, ח.פ, איש קשר, אימייל, טלפון ונייד לוואטסאפ, עם כפתורי וואטסאפ / מייל / חיוג.
- **סנכרון** — כניסה עם Google ושמירה במסמך `users/{uid}/data/state`. הנתונים נשמרים גם במכשיר, ומתמזגים כשמתחברים.
- **גיבוי ושחזור** לקובץ JSON מתפריט ההגדרות.

## שלבים הבאים

1. חשבוניות: הוספה ידנית ושיוך לסעיף ולחברה (הניצול בסעיפים יתעדכן אוטומטית).
2. קריאת חשבוניות עם Gemini דרך Cloud Function (כמו `scanReceipt` ב-TripCost).
3. הפקת דוח תשלום 1007 עם הסכום וסעיף התקציב.
4. הטבעת חותמת על החשבונית ושליחה בוואטסאפ או במייל.

## הגדרה חד-פעמית

1. **ריפו:** ליצור ב-GitHub ריפו חדש (למשל `tzahram-budget`) ולהעלות את כל הקבצים.
   Settings ← Pages ← Source: `main` / root.
2. **Firebase:** ב-[Firebase Console](https://console.firebase.google.com/) ← Add project.
   - Build ← **Authentication** ← Get started ← Sign-in method ← **Google** ← Enable.
   - Authentication ← Settings ← **Authorized domains** ← להוסיף `itairosenblum-hash.github.io`.
   - Build ← **Firestore Database** ← Create database (אזור `europe-west1`) ← Rules ← להדביק את `firestore.rules` ← Publish.
   - Project settings ← Your apps ← **Web** (`</>`) ← Register ← להעתיק את ה-`firebaseConfig`.
3. **חיבור האתר:** להדביק את ה-config ב-`DEFAULT_FIREBASE_CONFIG` בתוך `index.html`
   (או באתר עצמו: תפריט ← הגדרת Firebase).

## פריסת האתר

בכל שינוי בקבצי האתר מעלים את `CACHE_NAME` ב-`sw.js` ומעדכנים את `versionStamp` בתחתית `index.html`.
חוקי Firestore מתעדכנים ידנית ב-Firebase Console.
