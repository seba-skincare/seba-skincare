const GITHUB_API = "https://api.github.com";
const OWNER = "seba-skincare";
const REPO = "seba-skincare";
const BRANCH = "main";

export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "https://seba-skincare.github.io",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers
    });
  }

  try {
    const { password, path, content } = await req.json();

    if (!process.env.ADMIN_PASSWORD ||
        password !== process.env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers
      });
    }

    const allowedPaths = [
      "data/services.json",
      "data/settings.json"
    ];

    if (!allowedPaths.includes(path) || typeof content !== "string") {
      return new Response(JSON.stringify({ error: "Invalid file or content" }), {
        status: 400, headers
      });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GitHub token is missing");

    const apiUrl = `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`;
    const authHeaders = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };

    const current = await fetch(`${apiUrl}?ref=${BRANCH}`, {
      headers: authHeaders
    });

    let sha;
    if (current.ok) {
      const file = await current.json();
      sha = file.sha;
    } else if (current.status !== 404) {
      throw new Error("Could not check existing file");
    }

    const saved = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Update ${path} from Seba admin`,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {})
      })
    });

    if (!saved.ok) {
      throw new Error("GitHub could not save the file");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Save failed" }), {
      status: 500, headers
    });
  }
};
