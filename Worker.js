import appHtml from "./index.html";

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

    if (request.method === "GET" || request.method === "HEAD") {
      return new Response(request.method === "HEAD" ? null : appHtml, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }

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
      styleId,
      styleName,
      styleDescription,
      landmarkCount = 478,
      scanAngles = 4,
      geometry = null,
    } = body || {};

    if (!base || !styleName) {
      return json({ message: "Missing base image or selected style." }, 400);
    }

    const images = [base, ...references].slice(0, 4);
    const form = new FormData();

    images.forEach((dataUrl, index) => {
      form.append(`input_image_${index}`, dataUrlToBlob(dataUrl), `scan-${index}.jpg`);
    });

    form.append("prompt", buildPrompt({ category, styleId, styleName, styleDescription, landmarkCount, scanAngles, geometry }));
    form.append("width", "768");
    form.append("height", "1024");

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


function buildPrompt({ category, styleId, styleName, styleDescription, landmarkCount, scanAngles, geometry }) {
  const type = category === "mustaches" ? "mustache" : category === "sideburns" ? "sideburn style" : "beard style";
  const geometryNotes = geometry
    ? `Scanner geometry notes: average profile turn ${Number(geometry.profileTurn || 0).toFixed(2)}. Estimated neckline drop ${Number(geometry.neckDrop || 0).toFixed(2)} of face height. Derived throat-center drop ${Number(geometry.throatDrop || 0).toFixed(2)} of face height, calibrated using the chin-up capture. Use these notes only to keep the trim placement anatomically correct on this exact face.`
    : "";
  const styleRules = getStyleRules({ category, styleId, styleName });

  return `Create a photorealistic grooming preview of the SAME real person shown in the supplied scan photographs.

Image 0 is the authoritative front photograph and the direct edit target.
Images 1-3 are additional views of the SAME person. Use them only as identity and geometry references so the edited result keeps the same cheeks, jaw, chin, sideburns and neckline as the real person.

The grooming scanner captured approximately ${landmarkCount} facial landmarks across ${scanAngles} guided angles. ${geometryNotes}
Selected ${type}: ${styleName}. ${styleDescription || ""}
Style placement rules: ${styleRules}

CRITICAL EDITING RULES:
- Preserve the exact same person from Image 0.
- Preserve the exact face shape, bone structure, cheek width, jaw width, chin shape, lips, nose, eyes, eyebrows, skin tone, skin texture, hairstyle, ears, neck, pose, framing, camera angle, lighting, exposure and background.
- Edit FACIAL HAIR ONLY.
- Completely remove all beard or mustache hair that falls outside the selected style. Those removed areas must show normal natural skin, not shadowy leftover beard coverage.
- If the selected style is a goatee, circle beard, mustache-only style, sideburn-only style, or any smaller style, the cheeks, side jaw and neck must visibly appear shaved where appropriate.
- Do NOT keep the old full beard shape.
- Do NOT change or beautify the face. No bone-structure changes, no slimming, no widening, no cheek lifting, no nose changes, no eye changes, and no head-shape changes.
- Render realistic facial-hair texture only in the selected style regions, with believable density, barber-clean edges and natural transitions.
- Keep the facial-hair placement faithful to the scanned face geometry.
- No overlays, masks, paint effects, guide lines, blobs, interface text or cartoon styling.
- The final result must look like a realistic before/after grooming mockup of exactly how this person would look wearing ONLY the selected ${type}.`;
}

function getStyleRules({ category, styleId, styleName }) {
  const id = `${category || ""}:${styleId || ""}`;
  const map = {
    "beards:goatee": "Keep hair only on the mustache and chin/goatee region. Remove cheek beard, jaw beard and neck beard so the cheeks appear clean-shaven.",
    "beards:circle": "Keep a connected mustache and rounded goatee around the mouth. Remove beard from the outer cheeks and jaw outside the circle beard shape.",
    "beards:van-dyke": "Keep a detached mustache and a pointed chin beard. Remove hair from the cheeks, side jaw and any connection between mustache and chin.",
    "beards:anchor": "Keep a neat mustache and a narrow anchor-shaped chin/jaw section. Remove fuller cheek beard and excess neck beard.",
    "beards:short-boxed": "Keep a neat short boxed beard tightly following the jaw and chin with defined cheek lines and a tidy neckline. Remove stray beard growth outside the boxed outline.",
    "beards:full": "Keep a full beard, but refine the outline so it looks clean, intentional and professionally groomed.",
    "beards:ducktail": "Keep a full beard that narrows and lengthens toward the chin into a ducktail point. Clean up cheeks and neckline outside the intended silhouette.",
    "beards:balbo": "Keep a floating mustache with a separated trimmed beard on the chin and lower jaw. Remove connecting cheek beard where it should be detached.",
    "beards:garibaldi": "Keep a broader fuller beard with a rounded lower edge, while still cleaning obvious outer stray growth and sharpening the upper cheek lines.",
    "beards:stubble": "Keep only short even stubble with clean cheek and neckline edges. Remove any bulky or long beard appearance.",
    "beards:chinstrap": "Keep a narrow band of facial hair tracing the jaw from sideburn to sideburn, with minimal chin fullness and clean shaved cheeks.",
    "beards:hollywoodian": "Keep fuller beard on the jaw and chin but reduce the upper sideburn/cheek connection so the upper cheeks are cleaner.",
    "mustaches:natural-tache": "Keep only a natural mustache along the upper lip. Remove beard growth from the chin, cheeks and jaw.",
    "mustaches:chevron": "Keep only a fuller chevron mustache. Remove beard hair from the chin, cheeks and jaw.",
    "mustaches:handlebar": "Keep only a mustache with longer outward-curving ends. Remove beard hair from the chin, cheeks and jaw.",
    "mustaches:english": "Keep only a narrow mustache with long pointed ends. Remove beard hair from the chin, cheeks and jaw.",
    "mustaches:pencil": "Keep only a very thin pencil mustache above the upper lip. Remove beard hair from the chin, cheeks and jaw.",
    "mustaches:horseshoe": "Keep a mustache with vertical extensions beside the mouth, but remove cheek beard and jaw beard.",
    "mustaches:walrus": "Keep only a heavy walrus mustache and remove beard hair from the cheeks, chin and jaw.",
    "mustaches:pyramid": "Keep only a pyramid-shaped mustache above the upper lip. Remove beard hair from the cheeks, chin and jaw.",
    "sideburns:short-sideburns": "Keep only short sideburns ending high near the upper ear. Remove other beard hair from cheeks, jaw, chin and lip.",
    "sideburns:classic-sideburns": "Keep only classic straight sideburns. Remove beard hair from the cheeks, jaw, chin and mustache unless naturally minimal.",
    "sideburns:tapered-sideburns": "Keep only tapered sideburns. Remove beard hair from the cheeks, jaw, chin and mustache.",
    "sideburns:flared-sideburns": "Keep only flared sideburns. Remove beard hair from the cheeks below them, jaw, chin and mustache.",
    "sideburns:mutton-chops": "Keep wide mutton-chop sideburns extending forward on the cheeks, but keep the chin shaved clean and do not show a full beard under the jaw."
  };
  return map[id] || `${styleName} should appear cleanly shaped and intentional, and all facial hair outside that style should be removed.`;
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
