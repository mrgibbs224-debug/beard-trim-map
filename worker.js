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
      fusion = null,
      mirrored = false,
    } = body || {};

    if (!base || !styleName) {
      return json({ message: "Missing base image or selected style." }, 400);
    }

    const form = new FormData();

    // Identity lock: use ONLY the front/base scan image as the actual edit target.
    // Additional scan angles are intentionally NOT passed as extra images because
    // multi-image image editing can cause blended faces, ghost faces, or shifted identity.
    form.append("input_image", dataUrlToBlob(base), "front-scan.jpg");

    form.append(
      "prompt",
      buildPrompt({
        category,
        styleId,
        styleName,
        styleDescription,
        landmarkCount,
        scanAngles,
        referenceCount: Array.isArray(references) ? references.length : 0,
        geometry,
        fusion,
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

function buildPrompt({ category, styleId, styleName, styleDescription, landmarkCount, scanAngles, referenceCount, geometry, fusion, mirrored }) {
  const type = category === "mustaches" ? "mustache" : category === "sideburns" ? "sideburn style" : "beard style";
  const orientationNotes = mirrored
    ? "The source selfie orientation is mirrored. Keep the final image in the exact same mirrored orientation as the source photo. Do not flip it."
    : "Keep the final image in the exact same orientation as the source photo. Do not mirror or rotate it.";
  const geometryNotes = geometry
    ? `Scanner geometry notes: average profile turn ${Number(geometry.profileTurn || 0).toFixed(2)}. Estimated neckline drop ${Number(geometry.neckDrop || 0).toFixed(2)} of face height. Derived throat-center drop ${Number(geometry.throatDrop || 0).toFixed(2)} of face height. Estimated chin-lift factor ${Number(geometry.chinLift || 0).toFixed(2)}. Use these only to place the facial hair correctly on this exact real face.`
    : "";
  const fusionNotes = fusion
    ? `Burst-scan quality notes: ${Number(fusion.acceptedFrames || 0)} accepted frames were fused from ${Number(fusion.burstFrames || 0)} rapid captures across ${scanAngles} scan angles, with overall fusion confidence ${Math.round(Number(fusion.confidence || 0) * 100)}%. The extra ${referenceCount} scan-angle photos exist only as measurement references and must NOT be visually blended into the final image.`
    : "";
  const styleRules = getStyleRules({ category, styleId, styleName });

  return `Edit the supplied photograph into a photorealistic grooming preview of the SAME real person.

The supplied image is the one and only direct edit target. Treat it as an actual photo-edit, not as inspiration and not as a re-generation.
The result must look like the SAME phone photo of the SAME real person, with the SAME composition, same camera distance, same head size, same pose, same expression, same body position, same lighting, same skin, same hair, and same background — only the facial hair style changes.

Selected ${type}: ${styleName}. ${styleDescription || ""}
Style placement rules: ${styleRules}
Scanner reference notes: approximately ${landmarkCount} facial landmarks across ${scanAngles} guided scan angles. ${geometryNotes} ${fusionNotes}
${orientationNotes}

ABSOLUTE IDENTITY-LOCK RULES:
- Preserve the exact person from the input image.
- Keep the exact face shape, skull shape, jaw width, chin width, chin length, cheek fullness, cheekbone structure, nose shape, eye size and spacing, eyelids, eyebrows, lips, ears, hairline, hairstyle, neck, shoulders and visible body.
- Preserve exact camera framing and crop.
- Preserve the exact background and scene.
- Preserve the exact lighting direction and realism.
- Do not beautify, stylize, recompose or change the person.
- Do not make the person thinner, younger, older, more symmetrical, more attractive, more angular or differently proportioned.
- Do not change bone structure in any way.

CRITICAL ANTI-ARTIFACT RULES:
- Show exactly ONE person.
- Show exactly ONE face.
- Never create a second face, ghost face, duplicate head, partial extra face, background face, double exposure, echoed facial feature, blended profile, or face fragment.
- Never merge multiple scan angles into one visible image.
- Never create extra eyes, extra brows, extra nose shapes, duplicated cheek lines, or offset facial features.
- Never alter the perspective or move the face in frame.

FACIAL-HAIR EDIT RULES:
- Modify facial hair only.
- Remove all beard or mustache hair outside the selected style.
- The shaved-away areas must show believable natural skin matching the real face, with subtle realistic shaving shadow only where appropriate.
- Do not leave the original full beard visible if the selected style is smaller.
- Keep the beard density and direction natural to the person's actual beard growth.
- Keep all beard placement centered and anatomically correct on this real face.
- Keep edges crisp, barber-clean and realistic.
- If the selected style is full beard, simply refine and clean the beard into that full-beard shape without changing the rest of the photo.

OUTPUT RULES:
- No guide lines, masks, labels, overlays, blobs, UI, or artistic effects.
- The final output must look like a realistic mirror-photo preview of this exact user after trimming into ONLY the selected ${type}.
- If there is any conflict, prioritize identity preservation, single-face integrity, and photo realism above everything else.`;
}

function getStyleRules({ category, styleId, styleName }) {
  const id = `${category || ""}:${styleId || ""}`;
  const map = {
    "beards:goatee": "Keep hair only on the mustache and chin/goatee region. Remove cheek beard, jaw beard and neck beard so the cheeks appear clean-shaven.",
    "beards:circle": "Keep a connected mustache and rounded goatee around the mouth. Remove beard from the outer cheeks and jaw outside the circle beard shape.",
    "beards:van-dyke": "Keep a detached mustache and a pointed chin beard. Remove hair from the cheeks, side jaw and any connection between mustache and chin.",
    "beards:anchor": "Keep a neat mustache and a narrow anchor-shaped chin/jaw section. Remove fuller cheek beard and excess neck beard.",
    "beards:short-boxed": "Keep a neat short boxed beard tightly following the jaw and chin with defined cheek lines and a tidy neckline. Remove stray beard growth outside the boxed outline.",
    "beards:full": "Keep a full beard, but refine the outline so it looks clean, intentional and professionally groomed while preserving the exact existing face.",
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
