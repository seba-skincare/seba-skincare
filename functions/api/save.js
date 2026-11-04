const OWNER = "seba-skincare";
const REPO = "seba-skincare";

const API = "https://api.github.com";

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function onRequest(context) {
  const { request, env } = context;
  const branch = env.CF_PAGES_branch && env.CF_PAGES_branch !== "main" ? env.CF_PAGES_branch : "main";
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin") || "";
  const sameOrigin = !origin || origin === requestOrigin;
  const headers = {
    "Access-Control-Allow-Origin": sameOrigin ? (origin || requestOrigin) : "null",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };

  if (!sameOrigin) return json({ error: "Origin not allowed" }, 403, headers);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

  try {
    if (!env.ADMIN_PASSWORD || !env.GITHUB_TOKEN) {
      return json({ error: "إعدادات الحفظ غير مكتملة على Cloudflare" }, 503, headers);
    }

    const body = await request.json();
    const { password, path, content, action, imageBase64 } = body || {};

    if (typeof password !== "string" || password !== env.ADMIN_PASSWORD) {
      return json({ error: "كلمة المرور غير صحيحة" }, 401, headers);
    }

    const isImage = action === "upload-image";
    if (isImage) {
      if (
        typeof path !== "string" ||
        !/^assets[/]services[/]service-[0-9]+-[0-9]+[.](jpg|jpeg|png|webp|gif)$/i.test(path) ||
        typeof imageBase64 !== "string" ||
        imageBase64.length > 7_000_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)
      ) {
        return json({ error: "ملف الصورة غير صالح أو حجمه كبير" }, 400, headers);
      }
    } else {
      const allowedPaths = ["data/services.json", "data/settings.json", "data/offers.json"];
      if (!allowedPaths.includes(path) || typeof content !== "string" || content.length > 1_000_000) {
        return json({ error: "الملف أو المحتوى غير صالح" }, 400, headers);
      }
      try {
        JSON.parse(content);
      } catch {
        return json({ error: "محتوى JSON غير صالح" }, 400, headers);
      }
    }

    const apiUrl = API + "/repos/" + OWNER + "/" + REPO + "/contents/" + path;
    const authHeaders = {
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const current = await fetch(apiUrl + "?ref=" + branch, { headers: authHeaders });
    let sha;
    if (current.ok) {
      const file = await current.json();
      sha = file.sha;
    } else if (current.status !== 404) {
      return json({ error: "تعذّر فحص الملف الحالي على GitHub" }, 502, headers);
    }

    const encoded = isImage ? imageBase64 : encodeBase64Utf8(content);
    const saved = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: isImage ? "Upload service image " + path : "Update " + path + " from Seba admin",
        content: encoded,
        branch: branch,
        ...(sha ? { sha } : {})
      })
    });

    if (!saved.ok) {
      const details = await saved.text();
      return json({ error: "فشل الحفظ على GitHub", details: details.slice(0, 250) }, 502, headers);
    }

    const savedData = await saved.json();
    let verified = false;

    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 800));
      const check = await fetch(apiUrl + "?ref=" + branch + "&verify=" + Date.now(), {
        headers: { ...authHeaders, "Cache-Control": "no-cache" }
      });
      if (!check.ok) continue;
      const file = await check.json();
      if (isImage) {
        verified = Boolean(file.sha);
      } else if (typeof file.content === "string") {
        verified = decodeBase64Utf8(file.content) === content;
      }
      if (verified) break;
    }

    if (!verified) {
      return json({ success: false, error: "وصل طلب الحفظ إلى GitHub، لكن تعذّر التحقق من الملف بعد الحفظ." }, 502, headers);
    }

    return json({
      success: true,
      verified: true,
      path,
      commit: savedData.commit?.sha || null,
      contentSha: savedData.content?.sha || null
    }, 200, headers);
  } catch (error) {
    return json({ error: error?.message || "Save failed" }, 500, headers);
  }
}
