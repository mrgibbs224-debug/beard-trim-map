import appHtml from "./index.html";

const MODEL = "@cf/black-forest-labs/flux-1-schnell";
const ALLOWED_ORIGINS = ["https://appassets.androidplatform.net", "https://beardtrimmap.com"];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const isAllowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/render-preview") {
      if (request.method !== "POST") return json({ message: "POST required" }, 405, origin);
      return renderPreview(request, env, origin);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return new Response(request.method === "HEAD" ? null : appHtml, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function renderPreview(request, env, origin) {
  if (!env.AI) {
    return json({ code: "CONFIG_MISSING", message: "AI binding missing" }, 503, origin);
  }

  try {
    const { base, mask, styleName, styleDescription, mirrored } = await request.json();
    if (!base || !styleName) return json({ message: "Missing image or style" }, 400, origin);

    const prompt = `Photorealistic grooming preview: ${styleName}. ${styleDescription}.
      Target: Identity-preserving localized facial hair edit.
      Maintain exact facial features, background, and lighting from the original photo.
      ${mirrored ? "Maintain mirrored orientation." : ""}
      Modify ONLY the beard area defined by the mask.`;

    const inputs = {
      prompt,
      image: dataUrlToArray(base),
      mask: mask ? dataUrlToArray(mask) : undefined,
    };

    const result = await env.AI.run(MODEL, inputs);
    const image = result?.image;

    if (!image) throw new Error("AI returned no image");

    return json({ image: `data:image/png;base64,${image}` }, 200, origin);
  } catch (error) {
    console.error(error);
    return json({ code: "ERROR", message: error.message }, 500, origin);
  }
}

function dataUrlToArray(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Array.from(bytes);
}

function json(value, status = 200, origin = null) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin || ALLOWED_ORIGINS[0],
    },
  });
}
