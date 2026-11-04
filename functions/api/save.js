const OWNER = "seba-skincare";
const REPO = "seba-skincare";
const BRANCH = "main";
const API = "https://api.github.com";

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    }
  });
}

function allowedOrigin(origin) {
  return origin === "https://seba-skincare.pages.dev" ||
    /^https:\/\/[a-z0-9-]+\.seba-skincare\.pages\.dev$/i.test(origin) ||
    origin === "https://seba-skincare.github.io";
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin(origin)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Vary": "Origin",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN) {
    return json({ error: "إعدادات الحفظ غير مكتملة على Cloudflare Pages. تحققي من ADMIN_PASSWORD و GITHUB_TOKEN." }, 500, origin);
  }

  try {
    const raw = await request.text();
    if (raw.length > 10_000_000) return json({ error: "حجم الطلب كبير جداً" }, 413, origin);
    const body = JSON.parse(raw);
    const { password, path, content, action, imageBase64 } = body || {};

    if (typeof password !== "string" || password !== env.ADMIN_PASSWORD) {
      return json({ error: "كلمة المرور غير صحيحة" }, 401, origin);
    }

    const isImage = action === "upload-image";
    if (isImage) {
      if (typeof path !== "string" ||
          !/^assets\/services\/service-[0-9]+-[0-9]+\.(jpg|jpeg|png|webp|gif)$/i.test(path) ||
          typeof imageBase64 !== "string" ||
          imageBase64.length > 7_000_000) {
        return json({ error: "ملف الصورة غير صالح أو حجمه كبير" }, 400, origin);
      }
    } else {
      const allowedPaths = ["data/services.json", "data/settings.json", "data/offers.json"];
      if (!allowedPaths.includes(path) || typeof content !== "string" || content.length > 2_000_000) {
        return json({ error: "الملف أو المحتوى غير مسموح" }, 400, origin);
      }
      try { JSON.parse(content); } catch { return json({ error: "محتوى JSON غير صالح" }, 400, origin); }
    }

    const bytes = isImage ? decodeBase64(imageBase64) : new TextEncoder().encode(content);
    if (isImage && bytes.length > 5 * 1024 * 1024) {
      return json({ error: "حجم الصورة يتجاوز 5 ميغابايت" }, 400, origin);
    }

    const apiUrl = `${API}/repos/${OWNER}/${REPO}/contents/${path}`;
    const authHeaders = {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const current = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers: authHeaders });
    let sha;
    if (current.ok) {
      const file = await current.json();
      sha = file.sha;
    } else if (current.status !== 404) {
      const detail = await current.text();
      return json({ error: "تعذر قراءة الملف من GitHub", details: detail.slice(0, 250) }, 502, origin);
    }

    const saved = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: isImage ? `Upload service image ${path}` : `Update ${path} from Seba admin`,
        content: encodeBase64(bytes),
        branch: BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    if (!saved.ok) {
      const detail = await saved.text();
      return json({ error: "فشل الحفظ على GitHub", details: detail.slice(0, 300) }, 502, origin);
    }

    const savedData = await saved.json();
    let verified = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 700));
      const check = await fetch(`${apiUrl}?ref=${BRANCH}&verify=${Date.now()}`, {
        headers: { ...authHeaders, "Cache-Control": "no-cache" }
      });
      if (!check.ok) continue;
      const file = await check.json();
      if (typeof file.content !== "string") continue;
      const actual = decodeBase64(file.content);
      if (actual.length !== bytes.length) continue;
      verified = actual.every((byte, index) => byte === bytes[index]);
      if (verified) break;
    }

    if (!verified) {
      return json({ success: false, error: "وصل طلب الحفظ إلى GitHub، لكن تعذّر التحقق من الملف بعد الحفظ." }, 502, origin);
    }

    return json({
      success: true,
      verified: true,
      path,
      commit: savedData.commit?.sha || null,
      contentSha: savedData.content?.sha || null
    }, 200, origin);
  } catch (error) {
    return json({ error: error?.message || "Save failed" }, 500, origin);
  }
}
