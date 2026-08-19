const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "beard-trim-map", aiBinding: Boolean(env.AI) });
    }

    if (url.pathname === "/api/render-preview") {
      if (request.method !== "POST") return json({ message: "POST required" }, 405);
      return renderPreview(request, env);
    }

    // This branch is mainly useful in local development. Static asset routing handles
    // normal app requests before they reach the Worker.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

async function renderPreview(request, env) {
  if (!env.AI) {
    return json({
      code: "CONFIG_MISSING",
      message: "Workers AI binding 'AI' is not configured for this Worker.",
    }, 503);
  }

  try {
    const body = await request.json();
    const {
      base,
      references = [],
      category,
      styleName,
      styleDescription,
      landmarkCount = 478,
      scanAngles = 4,
    } = body || {};

    if (!base || !styleName) {
      return json({ message: "Missing base image or selected style." }, 400);
    }

    const images = [base, ...references].slice(0, 4);
    const form = new FormData();

    images.forEach((dataUrl, index) => {
      form.append(`input_image_${index}`, dataUrlToBlob(dataUrl), `scan-${index}.jpg`);
    });

    form.append("prompt", buildPrompt({ category, styleName, styleDescription, landmarkCount, scanAngles }));
    form.append("width", "768");
    form.append("height", "1024");
    form.append("guidance", "3.5");

    // Workers AI's FLUX multipart API needs the serialized multipart stream and its
    // generated boundary/content-type, so serialize FormData through Response first.
    const serialized = new Response(form);
    const result = await env.AI.run(MODEL, {
      multipart: {
        body: serialized.body,
        contentType: serialized.headers.get("content-type"),
      },
    });

    const image = result?.image;
    if (!image) {
      return json({ code: "IMAGE_EDIT_FAILED", message: "Workers AI returned no preview image." }, 502);
    }

    return json({ image: `data:image/png;base64,${image}` });
  } catch (error) {
    console.error("render-preview", error);
    const message = error?.message || "Cloudflare Workers AI preview failed.";
    const lowered = message.toLowerCase();
    const code = lowered.includes("quota") || lowered.includes("neuron") || lowered.includes("limit")
      ? "quota_exceeded"
      : lowered.includes("auth") || lowered.includes("permission")
        ? "AUTH_FAILED"
        : "IMAGE_EDIT_FAILED";
    return json({ code, message }, 500);
  }
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!match) throw new Error("Invalid image payload");
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function buildPrompt({ category, styleName, styleDescription, landmarkCount, scanAngles }) {
  const type = category === "mustaches" ? "mustache" : category === "sideburns" ? "sideburn" : "beard";
  return `Create a photorealistic professional grooming preview of the SAME person shown in the supplied scan photographs.

Image 0 is the authoritative front/base photograph. Preserve its exact composition, pose, expression, lighting, skin texture, head hair, clothing, body and background.
Images 1-3 are additional views of the SAME person. Use them only to improve identity consistency and understand the person's true jaw, cheek, chin, sideburn and neckline geometry.

The grooming scanner captured approximately ${landmarkCount} facial landmarks per accepted mesh across ${scanAngles} guided angles.
Selected ${type} style: ${styleName}. ${styleDescription || ""}

CRITICAL RULES:
- Keep this exact person's identity and facial proportions.
- Modify FACIAL HAIR ONLY.
- Do not change age, weight, skin tone, face shape, head hair, hairline, eyes, brows, nose, lips, clothing or background.
- Render individual natural hair strands, realistic density, follicles, authentic edges and lighting consistent with the base photograph.
- Where facial hair is removed, reveal natural skin matching the surrounding pores, tone and lighting.
- Do not add landmark dots, mapping lines, flat color regions, guide marks, text, interface elements, makeup, stickers or cartoon effects.
- The final result must look like a real professional barber preview photograph of this exact person wearing ${styleName}.`;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
