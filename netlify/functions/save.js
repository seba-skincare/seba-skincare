const GITHUB_API = "https://api.github.com";
const OWNER = "seba-skincare";
const REPO = "seba-skincare";
const BRANCH = "main";

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = origin === "https://seba-skincare.github.io" ||
    /^https:\/\/deploy-preview-[0-9]+--sprightly-horse-bca4a5\.netlify\.app$/.test(origin);
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin ? origin : "https://seba-skincare.github.io",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { password, path, content, action, imageBase64 } = body;

    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "كلمة المرور غير صحيحة" }), { status: 401, headers });
    }

    const isImage = action === "upload-image";
    if (isImage) {
      if (typeof path !== "string" ||
          !/^assets\/services\/service-[0-9]+-[0-9]+\.(jpg|jpeg|png|webp|gif)$/i.test(path) ||
          typeof imageBase64 !== "string" ||
          imageBase64.length > 7_000_000) {
        return new Response(JSON.stringify({ error: "ملف الصورة غير صالح أو حجمه كبير" }), { status: 400, headers });
      }
    } else {
      const allowedPaths = ["data/services.json", "data/settings.json", "data/offers.json"];
      if (!allowedPaths.includes(path) || typeof content !== "string") {
        return new Response(JSON.stringify({ error: "Invalid file or content" }), { status: 400, headers });
      }
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GitHub token is missing");

    const apiUrl = `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`;
    const authHeaders = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const current = await fetch(`${apiUrl}?ref=${BRANCH}`, { headers: authHeaders });
    let sha;
    if (current.ok) {
      const file = await current.json();
      sha = file.sha;
    } else if (current.status !== 404) {
      throw new Error("Could not check existing file");
    }

    const encoded = isImage ? imageBase64 : Buffer.from(content, "utf8").toString("base64");
    const saved = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: isImage ? `Upload service image ${path}` : `Update ${path} from Seba admin`,
        content: encoded,
        branch: BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    if (!saved.ok) {
      const details = await saved.text();
      return new Response(JSON.stringify({ error: "فشل الحفظ على GitHub", details: details.slice(0, 300) }), { status: 502, headers });
    }

    const savedData = await saved.json();

    // Confirm GitHub now serves the exact saved content from the production branch.
    let verified = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 800));
      const check = await fetch(`${apiUrl}?ref=${BRANCH}&verify=${Date.now()}`, {
        headers: { ...authHeaders, "Cache-Control": "no-cache" }
      });
      if (!check.ok) continue;
      const file = await check.json();
      if (isImage) {
        verified = Boolean(file.sha);
      } else if (typeof file.content === "string") {
        const actual = Buffer.from(file.content.replace(/\\s/g, ""), "base64").toString("utf8");
        verified = actual === content;
      }
      if (verified) break;
    }

    if (!verified) {
      return new Response(JSON.stringify({
        success: false,
        error: "وصل طلب الحفظ إلى GitHub، لكن تعذّر التحقق من الملف بعد الحفظ. لم نعلن نجاح العملية."
      }), { status: 502, headers });
    }

    return new Response(JSON.stringify({
      success: true,
      verified: true,
      path,
      commit: savedData.commit?.sha || null,
      contentSha: savedData.content?.sha || null
    }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Save failed" }), { status: 500, headers });
  }
};
