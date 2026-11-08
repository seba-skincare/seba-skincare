const MODEL = "@cf/meta/llama-3.1-8b-instruct";

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return reply({
      error: "المساعد لم يُفعّل بعد. يرجى ربط Workers AI باسم AI في إعدادات Cloudflare Pages."
    }, 503);
  }

  try {
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const language = body.language === "he" ? "he" : "ar";
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

    if (!message || message.length > 1200) {
      return reply({ error: "الرسالة فارغة أو طويلة جداً." }, 400);
    }

    const origin = new URL(request.url).origin;
    let services = [];
    try {
      const response = await fetch(new URL("/data/services.json", origin), {
        headers: { "Accept": "application/json" }
      });
      if (response.ok) {
        const data = await response.json();
        services = Array.isArray(data.services) ? data.services.slice(0, 30) : [];
      }
    } catch (_) {}

    const catalogue = services.map(item => ({
      name: item.title || "",
      nameHe: item.titleHe || "",
      description: item.description || "",
      descriptionHe: item.descriptionHe || "",
      price: item.price || ""
    }));

    const system = language === "he"
      ? `את עוזרת השירות של SEBA Beauty & Skincare. דברי בעברית נעימה, קצרה ומכבדת. מטרתך להסביר רק שירותים שמופיעים בקטלוג, לעזור ללקוחה לבחור ולכוון אותה לקביעת תור בוואטסאפ של סבא. קטלוג השירותים: ${JSON.stringify(catalogue)}. אל תמציאי מחירים, זמינות, תוצאות או טיפולים. אם מחיר לא מופיע, הציעי לברר מול סבא. תני מידע כללי בלבד; אל תאבחני מחלות עור ואל תوصي בטיפול רפואי. במקרה של כאב, דלקת, תגובה חריגה, פצע או חשש רפואי, הפני לרופא/ת עור. בשאלות על תור, اعرضي الرابط: https://wa.me/972526732880 . אל تدّعي أنك بشر.`
      : `أنتِ مساعدة SEBA Beauty & Skincare الافتراضية. احكي بعربية لطيفة ومختصرة وبصيغة مؤنثة. مهمتك شرح الخدمات الموجودة في الكتالوج فقط، ومساعدة الزائرة على اختيار الخدمة المناسبة وتوجيهها لحجز موعد مع صبا عبر واتساب. كتالوج الخدمات: ${JSON.stringify(catalogue)}. لا تخترعي أسعاراً أو مواعيد أو نتائج أو خدمات. إذا السعر غير موجود، اقترحي الاستفسار من صبا. قدّمي معلومات عامة فقط ولا تشخّصي أمراض الجلد ولا تصفي علاجاً طبياً. عند وجود ألم أو التهاب أو جرح أو تحسس شديد أو مشكلة جلدية مقلقة، انصحي بمراجعة طبيب جلدية. للحجز أعطي الرابط: https://wa.me/972526732880 . لا تدّعي أنك إنسانة.`;

    const messages = [
      { role: "system", content: system },
      ...history.filter(item =>
        item && (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
      ).map(item => ({ role: item.role, content: item.content.slice(0, 1200) })),
      { role: "user", content: message }
    ];

    const result = await env.AI.run(MODEL, {
      messages,
      max_tokens: 450,
      temperature: 0.45
    });

    const answer = result?.response || result?.result?.response || "";
    if (!answer) return reply({ error: "لم أتمكن من إنشاء رد الآن. جرّبي مرة ثانية." }, 502);
    return reply({ answer });
  } catch (error) {
    return reply({ error: "صار خلل مؤقت بالمساعد. جرّبي مرة ثانية بعد قليل." }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
