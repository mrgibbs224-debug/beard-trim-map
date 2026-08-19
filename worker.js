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
      mirrored = false,
    } = body || {};

    if (!base || !styleName) {
      return json({ message: "Missing base image or selected style." }, 400);
    }

    const images = [base, ...references].slice(0, 4);
    const form = new FormData();

    images.forEach((dataUrl, index) => {
      form.append(`input_image_${index}`, dataUrlToBlob(dataUrl), `scan-${index}.jpg`);
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

    const message = error?.message || "Cloudflare Workers AI preview failed.";
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

    return json({ code, message }, 500);
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

  return new Blob(bytes, { type: mime });
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
    ? "The source selfie orientation is mirrored. Keep the final image in the same mirrored orientation as the source front photo."
    : "Keep the final image in the same orientation as the source front photo.";

  const geometryNotes = geometry
    ? `Scanner geometry notes: average profile turn ${Number(
        geometry.profileTurn || 0
      ).toFixed(2)}. Estimated neckline drop ${Number(
        geometry.neckDrop || 0
      ).toFixed(2)} of face height. Derived throat-center drop ${Number(
        geometry.throatDrop || 0
      ).toFixed(2)} of face height. Estimated chin-lift factor ${Number(
        geometry.chinLift || 0
      ).toFixed(
        2
      )}. Use these notes only to keep the trim placement correct on this exact face.`
    : "";

  const styleRules = getStyleRules({
    category,
    styleId,
    styleName,
  });

  return `Edit the supplied photographs into a photorealistic grooming preview of the SAME real person.

Image 0 is the direct edit target and the authority for identity, framing, lighting, expression and background.

Images 1-3 are additional reference photos of the SAME person and must only be used to confirm facial-hair boundaries, jaw geometry, chin width, sideburn placement and neckline placement.

The grooming scanner captured approximately ${landmarkCount} facial landmarks across ${scanAngles} guided scan angles.

${geometryNotes}

Selected ${type}: ${styleName}.

${styleDescription || ""}

Style placement rules:

${styleRules}

${orientationNotes}

HARD IDENTITY-LOCK RULES:

- This must remain the exact same person from Image 0.
- Treat this as an edit of Image 0, not a reimagining.
- Preserve the exact face shape.
- Preserve the exact head shape.
- Preserve the exact skull shape.
- Preserve the exact jaw width.
- Preserve the exact chin shape.
- Preserve cheek fullness and cheekbone structure.
- Preserve nose size and shape.
- Preserve eye size and spacing.
- Preserve eyelids and eyebrows.
- Preserve lips and ears.
- Preserve hairline and hairstyle.
- Preserve neck and shoulders.
- Preserve skin texture, skin tone, freckles, pores and natural asymmetry.
- Preserve camera distance, pose, expression, lighting and background.
- Do not beautify the person.
- Do not stylize the person.
- Do not idealize the person.
- Do not make the person younger.
- Do not make the person older.
- Do not make the person slimmer.
- Do not make the person wider.
- Do not make the person's face more angular.
- Do not make the face more symmetrical.
- Do not alter bone structure in any way.

FACIAL-HAIR EDIT RULES:

- Modify facial hair only.
- Remove all beard or mustache hair outside the selected style.
- The shaved-away areas must reveal believable natural skin matching the real face.
- Preserve subtle normal skin texture.
- Show natural shaving shadow only where realistic.
- Do not leave the original full beard shape visible.
- The selected style must sit exactly where it would on this real face.
- Keep the outline crisp, barber-clean and anatomically believable.
- Keep beard density realistic and consistent with the person's natural facial hair.
- If the selected style is smaller than the current beard, clearly show cheeks, side jaw and neck shaved where appropriate.

OUTPUT RULES:

- No guide lines.
- No overlays.
- No labels.
- No masks.
- No blobs.
- No UI elements.
- No artistic effects.
- The result must look like a realistic phone photo of this exact person after trimming into ONLY the selected ${type}.
- If there is any conflict between style rendering and identity preservation, prioritize preserving identity and photo realism.`;
}

function getStyleRules({
  category,
  styleId,
  styleName,
}) {
  const id = `${category || ""}:${styleId || ""}`;

  const map = {
    "beards:goatee":
      "Keep hair only on the mustache and chin/goatee region. Remove cheek beard, jaw beard and neck beard so the cheeks appear clean-shaven.",

    "beards:circle":
      "Keep a connected mustache and rounded goatee around the mouth. Remove beard from the outer cheeks and jaw outside the circle beard shape.",

    "beards:van-dyke":
      "Keep a detached mustache and a pointed chin beard. Remove hair from the cheeks, side jaw and any connection between mustache and chin.",

    "beards:anchor":
      "Keep a neat mustache and a narrow anchor-shaped chin/jaw section. Remove fuller cheek beard and excess neck beard.",

    "beards:short-boxed":
      "Keep a neat short boxed beard tightly following the jaw and chin with defined cheek lines and a tidy neckline. Remove stray beard growth outside the boxed outline.",

    "beards:full":
      "Keep a full beard, but refine the outline so it looks clean, intentional and professionally groomed.",

    "beards:ducktail":
      "Keep a full beard that narrows and lengthens toward the chin into a ducktail point. Clean up cheeks and neckline outside the intended silhouette.",

    "beards:balbo":
      "Keep a floating mustache with a separated trimmed beard on the chin and lower jaw. Remove connecting cheek beard where it should be detached.",

    "beards:garibaldi":
      "Keep a broader fuller beard with a rounded lower edge, while still cleaning obvious outer stray growth and sharpening the upper cheek lines.",

    "beards:stubble":
      "Keep only short even stubble with clean cheek and neckline edges. Remove any bulky or long beard appearance.",

    "beards:chinstrap":
      "Keep a narrow band of facial hair tracing the jaw from sideburn to sideburn, with minimal chin fullness and clean shaved cheeks.",

    "beards:hollywoodian":
      "Keep fuller beard on the jaw and chin but reduce the upper sideburn/cheek connection so the upper cheeks are cleaner.",

    "mustaches:natural-tache":
      "Keep only a natural mustache along the upper lip. Remove beard growth from the chin, cheeks and jaw.",

    "mustaches:chevron":
      "Keep only a fuller chevron mustache. Remove beard hair from the chin, cheeks and jaw.",

    "mustaches:handlebar":
      "Keep only a mustache with longer outward-curving ends. Remove beard hair from the chin, cheeks and jaw.",

    "mustaches:english":
      "Keep only a narrow mustache with long pointed ends. Remove beard hair from the chin, cheeks and jaw.",

    "mustaches:pencil":
      "Keep only a very thin pencil mustache above the upper lip. Remove beard hair from the chin, cheeks and jaw.",

    "mustaches:horseshoe":
      "Keep a mustache with vertical extensions beside the mouth, but remove cheek beard and jaw beard.",

    "mustaches:walrus":
      "Keep only a heavy walrus mustache and remove beard hair from the cheeks, chin and jaw.",

    "mustaches:pyramid":
      "Keep only a pyramid-shaped mustache above the upper lip. Remove beard hair from the cheeks, chin and jaw.",

    "sideburns:short-sideburns":
      "Keep only short sideburns ending high near the upper ear. Remove other beard hair from cheeks, jaw, chin and lip.",

    "sideburns:classic-sideburns":
      "Keep only classic straight sideburns. Remove beard hair from the cheeks, jaw, chin and mustache unless naturally minimal.",

    "sideburns:tapered-sideburns":
      "Keep only tapered sideburns. Remove beard hair from the cheeks, jaw, chin and mustache.",

    "sideburns:flared-sideburns":
      "Keep only flared sideburns. Remove beard hair from the cheeks below them, jaw, chin and mustache.",

    "sideburns:mutton-chops":
      "Keep wide mutton-chop sideburns extending forward on the cheeks, but keep the chin shaved clean and do not show a full beard under the jaw.",
  };

  return (
    map[id] ||
    `${styleName} should appear cleanly shaped and intentional, and all facial hair outside that style should be removed.`
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
