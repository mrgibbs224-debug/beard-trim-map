import appHtml from "./index.html";

const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "beard-trim-map",
        aiBinding: Boolean(env.AI),
      });
    }

    if (url.pathname === "/api/render-preview") {
      if (request.method !== "POST") {
        return json({ message: "POST required" }, 405);
      }

      return renderPreview(request, env);
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

    return new Response("Not found", {
      status: 404,
      headers: {
        "cache-control": "no-store",
      },
    });
  },
};

async function renderPreview(request, env) {
  if (!env.AI) {
    return json(
      {
        code: "CONFIG_MISSING",
        message: "Workers AI binding 'AI' is not configured for this Worker.",
      },
      503
    );
  }

  try {
    const body = await request.json();

    const {
      base,
      references = [],
      category,
      styleId,
      styleName,
      styleDescription,
      landmarkCount = 478,
      scanAngles = 4,
      geometry = null,
      mirrored = false,
    } = body || {};

    if (!base || !styleName) {
      return json(
        {
          message: "Missing base image or selected style.",
        },
        400
      );
    }

    const images = [base, ...references].slice(0, 4);
    const form = new FormData();

    images.forEach((dataUrl, index) => {
      form.append(
        `input_image_${index}`,
        dataUrlToBlob(dataUrl),
        `scan-${index}.jpg`
      );
    });

    form.append(
      "prompt",
      buildPrompt({
        category,
        styleId,
