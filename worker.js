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
          "cache-control": "no-store",
        },
      });
    }

    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
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
      mirrored = false,
    } = body || {};

    if (!base || !styleName) {
      return json({ message: "Missing base image or selected style." }, 400);
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
        styleName,
        styleDescription,
        landmarkCount,
        scanAngles,
        geometry,
        mirrored,
      })
    );

    form.append("width", "896");
    form.append("height", "1152");

    const serialized = new Response(form);

    const result = await env.AI.run(MODEL, {
      multipart: {
        body: serialized.body,
        contentType: serialized.headers.get("content-type"),
      },
    });

    const image = result?.image;

    if (!image) {
      return json({
        code: "IMAGE_EDIT_FAILED",
        message: "Workers AI returned no preview image.",
      }, 502);
    }

    return json({
      image: `data:image/png;base64,${image}`,
    });
  } catch (error) {
    console.error("render-preview", error);

    const message =
      error?.message || "Cloudflare Workers AI preview failed.";

    const lowered = message.toLowerCase();

    const code =
      lowered.includes("quota") ||
      lowered.includes("neuron") ||
      lowered.includes("limit")
        ? "quota_exceeded"
        : lowered.includes("auth") ||
          lowered.includes("permission")
        ? "AUTH_FAILED"
        : "IMAGE_EDIT_FAILED";

    return json({
      code,
      message,
    }, 500);
  }
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || "");

  if (!match) {
    throw new Error("Invalid image payload");
  }

  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function buildPrompt({
  category,
  styleId,
  styleName,
  styleDescription,
  landmarkCount,
  scanAngles,
  geometry,
  mirrored,
}) {
  const type =
    category === "mustaches"
      ? "mustache"
      : category === "sideburns"
      ? "sideburn style"
      : "beard style";

  const orientationNotes = mirrored
    ? "The source selfie is mirrored. Keep the result in the same mirrored orientation as Image 0."
    : "Keep the result in the same orientation as Image 0.";

  const geometryNotes = geometry
    ? `Scanner geometry: profile turn ${Number(
        geometry.profileTurn || 0
      ).toFixed(2)}, neckline drop ${Number(
        geometry.neckDrop || 0
      ).toFixed(2)}, throat-center drop ${Number(
        geometry.throatDrop || 0
      ).toFixed(2)}, chin-lift ${Number(
        geometry.chinLift || 0
      ).toFixed(
        2
      )}. Use these only for trim placement on this exact face.`
    : "";

  const styleRules = getStyleRules({
    category,
    styleId,
    styleName,
  });

  return `Edit the supplied photographs into a photorealistic grooming preview of the SAME real person.

Image 0 is the direct edit target and the authority for identity, framing, lighting, expression and background.

Images 1-3 are additional photos of the SAME person. Use them only to confirm facial-hair boundaries, jaw geometry, chin width, sideburn placement and neckline placement.

The scanner captured approximately ${landmarkCount} facial landmarks across ${scanAngles} guided angles.

${geometryNotes}

Selected ${type}: ${styleName}.

${styleDescription || ""}

Style placement rules:

${styleRules}

${orientationNotes}

HARD IDENTITY LOCK:

- Treat this as an edit of Image 0, not a reimagining.
- Preserve the exact same person.
- Preserve face shape.
- Preserve head shape.
- Preserve jaw width.
- Preserve chin shape.
- Preserve cheek fullness.
- Preserve nose shape.
- Preserve eye size and spacing.
- Preserve eyebrows.
- Preserve lips.
- Preserve ears.
- Preserve hairline and hairstyle.
- Preserve neck and shoulders.
- Preserve skin tone and skin texture.
- Preserve pores and natural asymmetry.
- Preserve pose and expression.
- Preserve camera distance.
- Preserve lighting.
- Preserve background.
- Do not beautify.
- Do not stylize.
- Do not idealize.
- Do not age the person.
- Do not slim or widen the face.
- Do not reshape or symmetrize the face.
- Do not alter bone structure.

FACIAL HAIR ONLY:

- Modify facial hair only.
- Remove all facial hair outside the selected style.
- Shaved areas must reveal believable natural skin matching Image 0.
- Do not leave the original full beard silhouette visible.
- Place the selected style anatomically on this exact face.
- Keep realistic density and texture.
- Keep barber-clean edges.

OUTPUT:

- No guide lines.
- No overlays.
- No labels.
- No masks.
- No blobs.
- No UI.
- No artistic effects.
- The result must look like a realistic phone photo of this exact person after trimming into ONLY the selected ${type}.
- If style rendering conflicts with identity preservation, preserve identity first.`;
}

function getStyleRules({
  category,
  styleId,
  styleName,
}) {
  const id = `${category || ""}:${styleId || ""}`;

  const rules = {
    "beards:goatee":
      "Keep hair only on the mustache and chin/goatee region. Shave cheeks, side jaw and neck.",

    "beards:circle":
      "Keep a connected mustache and rounded goatee around the mouth. Shave outer cheeks, side jaw and excess neck.",

    "beards:van-dyke":
      "Keep a detached mustache and pointed chin beard. Shave cheeks, side jaw and the connection between mustache and chin.",

    "beards:anchor":
      "Keep a neat mustache and narrow anchor-shaped chin/lower-jaw section. Remove fuller cheek beard and excess neck beard.",

    "beards:short-boxed":
      "Keep a neat short boxed beard following the jaw and chin with defined cheek lines and tidy neckline.",

    "beards:full":
      "Keep a full beard but refine the cheek line, side outline and neckline into a clean professional shape.",

    "beards:ducktail":
      "Keep a full beard narrowing toward a longer pointed chin. Clean cheek and neckline growth outside the silhouette.",

    "beards:balbo":
      "Keep a floating mustache with a separated trimmed beard on chin and lower jaw. Remove cheek connections.",

    "beards:garibaldi":
      "Keep a broad full beard with a rounded lower edge and cleaned cheek and neck boundaries.",

    "beards:stubble":
      "Keep short even stubble with clean cheek and neckline edges. Remove bulky or long beard appearance.",

    "beards:chinstrap":
      "Keep a narrow jawline band from sideburn to sideburn with clean cheeks and limited chin fullness.",

    "beards:hollywoodian":
      "Keep fuller beard on jaw and chin while reducing upper cheek and sideburn connection.",

    "mustaches:natural-tache":
      "Keep only a natural mustache along the upper lip. Shave chin, cheeks and jaw.",

    "mustaches:chevron":
      "Keep only a fuller chevron mustache. Shave chin, cheeks and jaw.",

    "mustaches:handlebar":
      "Keep only a mustache with longer outward-curving ends. Shave chin, cheeks and jaw.",

    "mustaches:english":
      "Keep only a narrow mustache with long pointed ends. Shave chin, cheeks and jaw.",

    "mustaches:pencil":
      "Keep only a thin pencil mustache above the upper lip. Shave chin, cheeks and jaw.",

    "mustaches:horseshoe":
      "Keep a mustache with vertical extensions beside the mouth. Shave cheeks and jaw outside those extensions.",

    "mustaches:walrus":
      "Keep only a heavy walrus mustache. Shave cheeks, chin and jaw.",

    "mustaches:pyramid":
      "Keep only a pyramid-shaped mustache above the upper lip. Shave cheeks, chin and jaw.",

    "sideburns:short-sideburns":
      "Keep only short sideburns ending high near the upper ear. Shave cheeks, jaw, chin and lip.",

    "sideburns:classic-sideburns":
      "Keep only classic straight sideburns. Shave the rest of the beard area.",

    "sideburns:tapered-sideburns":
      "Keep only tapered sideburns. Shave cheeks, jaw, chin and mustache.",

    "sideburns:flared-sideburns":
      "Keep only flared sideburns. Shave cheeks below them, jaw, chin and mustache.",

    "sideburns:mutton-chops":
      "Keep wide mutton-chop sideburns extending onto the cheeks while keeping the chin clean-shaven.",
  };

  return (
    rules[id] ||
    `${styleName} should be cleanly shaped and intentional, with all facial hair outside that style removed.`
  );
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
